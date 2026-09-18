const { getMCPLimiter } = require('./concurrency/limiters');

class MCPSessionManager {
    constructor(mcpUrl, fetchFn = global.fetch) {
        this.mcpUrl = mcpUrl;
        this.fetchFn = fetchFn;
        this.sessionId = null;
        this.availableTools = [];
        this.formattedToolList = '';
        this.sessionLock = Promise.resolve();
    }

    /**
     * Parses SSE-formatted response data line
     * @param {string} rawResponse - Raw response text with SSE format
     * @returns {Object} Parsed JSON object
     * @throws {Error} If parsing fails
     */
    parseSSEResponse(rawResponse) {
        const lines = rawResponse.split('\n');
        const dataLine = lines.find(line => line.startsWith('data:'));
        if (!dataLine) {
            throw new Error('No data line found in response');
        }
        const jsonString = dataLine.substring(5).trim();
        try {
            return JSON.parse(jsonString);
        } catch (error) {
            throw new Error(`Failed to parse SSE response: ${error.message}`);
        }
    }

    log(reqId, ...args) {
        const prefix = reqId ? `[req=${reqId}]` : '[sys]';
        console.log(prefix, ...args);
    }

    async initializeSession(reqId = null) {
        let releaseLock;
        const acquireLock = new Promise(resolve => releaseLock = resolve);
        const previousLock = this.sessionLock;
        this.sessionLock = this.sessionLock.then(() => acquireLock);

        try {
            await previousLock;
            
            const mcpTimeoutMs = parseInt(process.env.MCP_TIMEOUT_MS) || 30000;
            const response = await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {},
                            prompts: {}
                        },
                        clientInfo: {
                            name: 'mongodb-agent',
                            version: '1.0.0'
                        }
                    }
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sessionIdHeader = response.headers.get('mcp-session-id');
            if (!sessionIdHeader) {
                throw new Error('No mcp-session-id header in response');
            }

            await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionIdHeader,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized'
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });

            this.sessionId = sessionIdHeader;
            this.log(reqId, '✓ Successfully initialized session with MongoDB MCP server');
            return sessionIdHeader;
        } catch (error) {
            console.error(`[req=${reqId || 'sys'}] Failed to initialize session:`, error);
            throw error;
        } finally {
            releaseLock();
        }
    }

    async fetchTools(reqId = null) {
        let releaseLock;
        const acquireLock = new Promise(resolve => releaseLock = resolve);
        const previousLock = this.sessionLock;
        this.sessionLock = this.sessionLock.then(() => acquireLock);

        try {
            await previousLock;
            const mcpTimeoutMs = parseInt(process.env.MCP_TIMEOUT_MS) || 30000;
            const response = await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': this.sessionId,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {},
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });
            const rawResponse = await response.text();
            const data = this.parseSSEResponse(rawResponse);
            this.availableTools = data.result.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
            this.formattedToolList = JSON.stringify(this.availableTools, null, 2);
            this.log(reqId, `✓ Successfully fetched ${this.availableTools.length} tools from mongodb-mcp-server.`);
        } catch (error) {
            console.error(`[req=${reqId || 'sys'}] Failed to fetch tools from mongodb-mcp-server:`, error);
            throw error;
        } finally {
            releaseLock();
        }
    }

    async reconnect(reqId, failedSessionId) {
        let releaseLock;
        const acquireLock = new Promise(resolve => releaseLock = resolve);
        const previousLock = this.sessionLock;
        this.sessionLock = this.sessionLock.then(() => acquireLock);

        try {
            await previousLock;
            
            // Crucial fix for race condition
            if (this.sessionId !== failedSessionId) {
                this.log(reqId, 'Session was already reconnected by another request.');
                return this.sessionId;
            }

            this.log(reqId, 'Re-initializing session...');
            
            const mcpTimeoutMs = parseInt(process.env.MCP_TIMEOUT_MS) || 30000;
            const response = await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'initialize',
                    params: {
                        protocolVersion: '2024-11-05',
                        capabilities: {
                            tools: {},
                            resources: {},
                            prompts: {}
                        },
                        clientInfo: {
                            name: 'mongodb-agent',
                            version: '1.0.0'
                        }
                    }
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const sessionIdHeader = response.headers.get('mcp-session-id');
            if (!sessionIdHeader) {
                throw new Error('No mcp-session-id header in response');
            }

            await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': sessionIdHeader,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    method: 'notifications/initialized'
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });

            this.sessionId = sessionIdHeader;

            // Fetch tools
            const toolsResponse = await this.fetchFn(this.mcpUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json, text/event-stream',
                    'Mcp-Session-Id': this.sessionId,
                },
                body: JSON.stringify({
                    jsonrpc: '2.0',
                    id: 2,
                    method: 'tools/list',
                    params: {},
                }),
                signal: AbortSignal.timeout(mcpTimeoutMs)
            });
            const toolsRawResponse = await toolsResponse.text();
            const toolsData = this.parseSSEResponse(toolsRawResponse);
            this.availableTools = toolsData.result.tools.map(tool => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
            }));
            this.formattedToolList = JSON.stringify(this.availableTools, null, 2);

            this.log(reqId, '✓ Successfully reconnected session with MongoDB MCP server');
            return this.sessionId;
        } catch (error) {
            console.error(`[req=${reqId || 'sys'}] Failed to reconnect session:`, error);
            throw error;
        } finally {
            releaseLock();
        }
    }

    async callTool(reqId, toolName, toolArguments, isRetry = false, overrideSessionId = null) {
        const mcpLimiter = await getMCPLimiter();
        
        return mcpLimiter(async () => {
            const currentSessionId = overrideSessionId || this.sessionId;
            
            try {
                const mcpTimeoutMs = parseInt(process.env.MCP_TIMEOUT_MS) || 30000;
                const response = await this.fetchFn(this.mcpUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json, text/event-stream',
                        'Mcp-Session-Id': currentSessionId,
                    },
                    body: JSON.stringify({
                        jsonrpc: '2.0',
                        id: Date.now(),
                        method: 'tools/call',
                        params: {
                            name: toolName,
                            arguments: toolArguments,
                        },
                    }),
                    signal: AbortSignal.timeout(mcpTimeoutMs)
                });
                
                if (response.status === 401 || response.status === 403 || response.status === 404) {
                    if (!isRetry) {
                        this.log(reqId, 'Session may have expired, attempting to reconnect...');
                        const newSessionId = await this.reconnect(reqId, currentSessionId);
                        this.log(reqId, `Reconnected, retrying tool call...`);
                        return await this.callTool(reqId, toolName, toolArguments, true, newSessionId);
                    } else {
                        throw new Error('Session reconnection failed');
                    }
                }
                
                const rawResponse = await response.text();
                const toolData = this.parseSSEResponse(rawResponse);
                
                if (!toolData.result) {
                    throw new Error('Invalid response from tool server');
                }
                
                return toolData.result.structuredContent?.data
                    || toolData.result.content
                    || toolData.result;
            } catch (error) {
                if (!isRetry && (error.code === 'ECONNREFUSED' || error.message.includes('fetch failed'))) {
                    this.log(reqId, 'Connection lost, attempting to reconnect...');
                    try {
                        const newSessionId = await this.reconnect(reqId, currentSessionId);
                        this.log(reqId, 'Reconnected successfully, retrying tool call...');
                        return await this.callTool(reqId, toolName, toolArguments, true, newSessionId);
                    } catch (reconnectError) {
                        console.error(`[req=${reqId}] Reconnection failed:`, reconnectError);
                        throw new Error('Lost connection to MongoDB MCP server and reconnection failed');
                    }
                }
                throw error;
            }
        });
    }
}

module.exports = MCPSessionManager;
