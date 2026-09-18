const MCPSessionManager = require('./mcp-session-manager');

// Mock limiters so p-limit doesn't hang in tests
jest.mock('./concurrency/limiters', () => ({
    getMCPLimiter: jest.fn().mockResolvedValue((fn) => fn())
}));

describe('MCPSessionManager', () => {
    let mockFetch;
    let manager;
    let reqId = 'test-req-id';

    beforeEach(() => {
        mockFetch = jest.fn();
        manager = new MCPSessionManager('http://mock-mcp', mockFetch);
        // Suppress logs during tests
        jest.spyOn(manager, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    test('1. Successful initialization and tool fetching', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'session-123']]),
        }).mockResolvedValueOnce({
            ok: true
        });

        const sessionId = await manager.initializeSession(reqId);
        expect(sessionId).toBe('session-123');
        expect(manager.sessionId).toBe('session-123');
        expect(mockFetch).toHaveBeenCalledTimes(2); // initialize + notifications/initialized

        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => 'data: {"result": {"tools": [{"name": "test-tool", "description": "test", "inputSchema": {}}]}}'
        });

        await manager.fetchTools(reqId);
        expect(manager.availableTools.length).toBe(1);
        expect(manager.availableTools[0].name).toBe('test-tool');
        expect(mockFetch).toHaveBeenCalledTimes(3); // + tools/list
    });

    test('2. Successful tool calling', async () => {
        manager.sessionId = 'session-123';
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'data: {"result": {"content": "tool-result"}}'
        });

        const result = await manager.callTool(reqId, 'test-tool', {});
        expect(result).toBe('tool-result');
        expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test('3. Session expiration triggers a transparent reconnection', async () => {
        manager.sessionId = 'old-session';
        
        // 1. Tool call returns 401
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 401
        });
        
        // 2. Reconnect: initialize
        mockFetch.mockResolvedValueOnce({
            ok: true,
            headers: new Map([['mcp-session-id', 'new-session']]),
        });
        
        // 3. Reconnect: notifications/initialized
        mockFetch.mockResolvedValueOnce({
            ok: true
        });
        
        // 4. Reconnect: tools/list
        mockFetch.mockResolvedValueOnce({
            ok: true,
            text: async () => 'data: {"result": {"tools": []}}'
        });
        
        // 5. Retry tool call
        mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => 'data: {"result": {"content": "success-after-reconnect"}}'
        });

        const result = await manager.callTool(reqId, 'test-tool', {});
        expect(result).toBe('success-after-reconnect');
        expect(manager.sessionId).toBe('new-session');
        expect(mockFetch).toHaveBeenCalledTimes(5);
    });

    test('4. Race condition prevention - multiple concurrent failures only trigger one reconnect network flow', async () => {
        manager.sessionId = 'failing-session';

        // Set up the fetch mock to handle the sequence for concurrent calls
        let callCount = 0;
        mockFetch.mockImplementation(async (url, options) => {
            const body = JSON.parse(options.body);
            if (body.method === 'tools/call') {
                // If it's a tool call with the failing session, return 401
                if (options.headers['Mcp-Session-Id'] === 'failing-session') {
                    return { ok: false, status: 401 };
                }
                // If it's a tool call with the new session, return success
                if (options.headers['Mcp-Session-Id'] === 'new-session-id') {
                    return { ok: true, status: 200, text: async () => 'data: {"result": {"content": "success"}}' };
                }
            } else if (body.method === 'initialize') {
                // Add a small delay to ensure concurrent requests pile up on the lock
                await new Promise(r => setTimeout(r, 10));
                callCount++;
                return { ok: true, headers: new Map([['mcp-session-id', 'new-session-id']]) };
            } else if (body.method === 'notifications/initialized') {
                return { ok: true };
            } else if (body.method === 'tools/list') {
                return { ok: true, text: async () => 'data: {"result": {"tools": []}}' };
            }
            throw new Error(`Unexpected fetch call: ${body.method}`);
        });

        // Fire 5 concurrent tool calls
        const promises = [];
        for (let i = 0; i < 5; i++) {
            promises.push(manager.callTool(`req-${i}`, 'test-tool', {}));
        }

        const results = await Promise.all(promises);

        // All 5 should succeed
        expect(results).toEqual(['success', 'success', 'success', 'success', 'success']);
        
        // The initialize should ONLY be called ONCE despite 5 concurrent 401s
        expect(callCount).toBe(1);
        expect(manager.sessionId).toBe('new-session-id');
    });
});
