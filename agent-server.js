const express = require('express');
const cors = require('cors');
const ProviderFactory = require('./shared/providers/provider-factory');
const ProviderConfig = require('./shared/config/provider-config');
const crypto = require('crypto');
const { getLLMLimiter, getMCPLimiter } = require('./shared/concurrency/limiters');
require('dotenv').config();

// Validate required environment variables and get provider config
let providerName, providerConfig;
try {
    const config = ProviderConfig.validate();
    providerName = config.provider;
    providerConfig = config.config;
} catch (error) {
    console.error('Configuration Error:', error.message);
    console.error('\nPlease check your .env file and ensure all required variables are set.');
    console.error('See .env.example for reference.');
    process.exit(1);
}

const app = express();
const port = process.env.PORT || 3012;

app.use(express.json());
app.use(cors());

// --- LLM Provider Setup (abstracted) ---
let llmProvider;

// --- MongoDB MCP Server setup ---
const MONGODB_MCP_SERVER_URI = process.env.MONGODB_MCP_SERVER_URI;

// Validate MongoDB MCP server URI
if (!MONGODB_MCP_SERVER_URI) {
    console.error('Missing required environment variable: MONGODB_MCP_SERVER_URI');
    process.exit(1);
}

const MCPSessionManager = require('./shared/mcp-session-manager');
const mcpManager = new MCPSessionManager(MONGODB_MCP_SERVER_URI);

// --- Utility Functions ---

/**
 * Request ID middleware
 */
app.use((req, res, next) => {
    req.id = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString();
    next();
});

const log = (reqId, ...args) => {
    const prefix = reqId ? `[req=${reqId}]` : '[sys]';
    console.log(prefix, ...args);
};

// --- Skill Loading ---
let loadedSkills = '';

const loadSkills = async () => {
    const skillsPath = process.env.MONGODB_AGENT_SKILLS_PATH;
    if (!skillsPath) {
        return;
    }

    try {
        const fs = require('fs/promises');
        const path = require('path');
        
        // Check if directory exists
        try {
            const stats = await fs.stat(skillsPath);
            if (!stats.isDirectory()) {
                console.warn(`[Skills] Path is not a directory: ${skillsPath}`);
                return;
            }
        } catch (err) {
            console.warn(`[Skills] Skills path does not exist: ${skillsPath}`);
            return;
        }

        const entries = await fs.readdir(skillsPath, { withFileTypes: true });
        let skillsContent = [];

        for (const entry of entries) {
            if (entry.isDirectory()) {
                const skillMdPath = path.join(skillsPath, entry.name, 'SKILL.md');
                try {
                    const content = await fs.readFile(skillMdPath, 'utf8');
                    skillsContent.push(`--- SKILL: ${entry.name} ---\n${content}\n`);
                    console.log(`[Skills] Loaded skill: ${entry.name}`);
                } catch (err) {
                    // SKILL.md doesn't exist or isn't readable, skip
                }
            }
        }

        if (skillsContent.length > 0) {
            loadedSkills = `\n\nAVAILABLE SKILLS:\n${skillsContent.join('\n')}\n`;
            console.log(`[Skills] Successfully loaded ${skillsContent.length} skills.`);
        }
    } catch (error) {
        console.error('[Skills] Error loading skills:', error.message);
    }
};

// --- ReAct Loop Implementation ---
/**
 * Runs the Reason + Act (ReAct) loop to autonomously handle multi-step tool execution
 * @param {Object} chat - LLM chat instance
 * @param {string} question - User's question
 * @param {string} formattedTools - Formatted tool list JSON string
 * @param {Object} res - Express response object
 * @returns {Promise<void>}
 */
const runReActLoop = async (reqId, chat, question, formattedTools, res) => {
    const llmLimiter = await getLLMLimiter(providerName);
    
    let isComplete = false;
    let iterations = 0;
    const maxIterations = parseInt(process.env.MAX_ITERATIONS) || 5;
    let finalAnswer = "I was unable to complete the task within the maximum number of steps.";
    
    let currentPrompt = `You are an expert MongoDB autonomous agent.
Your goal is to answer the user's question by taking actions and analyzing their results.

Here is a list of available tools:
${formattedTools}

${loadedSkills ? `You have the following skills available to guide your actions:\n${loadedSkills}\n` : ''}
User's request: "${question}"

Decide what to do next based on the request.
- If you need to use a tool to gather more information or execute a step, return a JSON object with "action": "tool", "toolName": "<name>", and "toolArguments": {<args>}.
- If you have gathered enough information and can answer the user's request (or if no tools are needed), return a JSON object with "action": "answer", and "finalAnswer": "<your natural language answer>".

Your response MUST be exactly ONE valid JSON object and nothing else. Do not use markdown blocks like \`\`\`json.`;

    while (!isComplete && iterations < maxIterations) {
        iterations++;
        log(reqId, `[ReAct] Iteration ${iterations}...`);
        
        const result = await llmLimiter(() => llmProvider.sendMessage(chat, currentPrompt));
        let textResponse = await llmProvider.extractTextResponse(result);
        chat = result.chat || chat; // handle immutable chat updates
        
        let action;
        try {
            // Robust JSON extraction to handle nested code blocks in the output
            let jsonString = textResponse;
            try {
                action = JSON.parse(jsonString);
            } catch (e) {
                // If direct parse fails, try extracting between first { and last }
                const start = textResponse.indexOf('{');
                const end = textResponse.lastIndexOf('}');
                if (start !== -1 && end !== -1 && end > start) {
                    action = JSON.parse(textResponse.substring(start, end + 1));
                } else {
                    throw new Error("No JSON object found");
                }
            }
        } catch (error) {
            log(reqId, '[ReAct] Failed to parse action JSON, falling back to treating response as final answer.');
            finalAnswer = textResponse;
            break;
        }

        if (action.action === 'answer' || (!action.toolName && action.finalAnswer)) {
            finalAnswer = action.finalAnswer || action.answer || textResponse;
            isComplete = true;
            log(reqId, '[ReAct] Final answer reached.');
        } else if (action.action === 'tool' || action.toolName) {
            log(reqId, `[ReAct] Tool selected: ${action.toolName}`);
            const toolArgs = action.toolArguments || action.arguments || {};
            try {
                const resultData = await mcpManager.callTool(reqId, action.toolName, toolArgs);
                currentPrompt = `Tool "${action.toolName}" returned:\n${JSON.stringify(resultData, null, 2)}\n\nDecide what to do next:
- To use another tool, return JSON: { "action": "tool", "toolName": "<name>", "toolArguments": {<args>} }
- To provide the final answer, return JSON: { "action": "answer", "finalAnswer": "<answer text>" }
Respond with ONLY valid JSON.`;
            } catch (error) {
                log(reqId, `[ReAct] Tool execution failed: ${error.message}`);
                currentPrompt = `Tool "${action.toolName}" failed with error: ${error.message}\n\nDecide what to do next (try another tool or provide an answer). Respond with ONLY valid JSON.`;
            }
        } else {
            log(reqId, '[ReAct] Unrecognized action format, ending loop.');
            finalAnswer = textResponse;
            break;
        }
    }

    if (!isComplete) {
        log(reqId, '[ReAct] Max iterations reached.');
    }

    return res.json({ answer: finalAnswer });
};

// --- Chat Endpoint ---
/**
 * Handles chat requests by selecting and calling appropriate tools from the MongoDB MCP server
 * @param {Object} req - Express request object
 * @param {string} req.body.question - The user's question
 * @param {Array} req.body.history - Chat history for context
 * @param {Object} res - Express response object
 * @returns {Promise<void>} Sends JSON response with answer or error
 */
app.post('/chat', async (req, res) => {
    const { question, history } = req.body;
    const reqId = req.id;

    if (mcpManager.availableTools.length === 0) {
        return res.status(500).json({
            answer: 'Tool list is not available. Please check the connection to the mongodb-mcp-server.'
        });
    }

    try {
        // Standardize history format if needed
        const standardizedHistory = llmProvider.standardizeHistory(history || []);
        
        // Create chat with provider
        const chat = await llmProvider.createChat(standardizedHistory);

        // Run the ReAct loop to autonomously handle multi-step actions
        await runReActLoop(reqId, chat, question, mcpManager.formattedToolList, res);

    } catch (error) {
        console.error(`[req=${reqId}] Error in LLM agent:`, error);
        if (error.name === 'TimeoutError') {
            res.status(504).json({ answer: 'Request timed out.' });
        } else {
            res.status(500).json({ answer: 'Sorry, there was an error processing your request.' });
        }
    }
});

app.get('/metrics', async (req, res) => {
    const llmLimiter = await getLLMLimiter(providerName);
    const mcpLimiter = await getMCPLimiter();
    res.json({
        llm: {
            activeCount: llmLimiter.activeCount,
            pendingCount: llmLimiter.pendingCount
        },
        mcp: {
            activeCount: mcpLimiter.activeCount,
            pendingCount: mcpLimiter.pendingCount
        }
    });
});

// --- Server Startup ---
app.listen(port, async () => {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║          MongoDB MCP Agent Server                        ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log(`\nServer starting at http://localhost:${port}`);
    console.log(`LLM Provider: ${providerName}`);
    
    try {
        // Load Skills
        await loadSkills();

        // Initialize LLM provider
        llmProvider = await ProviderFactory.createProvider(providerName, providerConfig);
        const metadata = llmProvider.getMetadata();
        console.log(`Model: ${metadata.model || 'unknown'}`);
        
        // Initialize MongoDB MCP session
        await mcpManager.initializeSession();
        
        // Fetch tools from MCP server
        await mcpManager.fetchTools();
        
        console.log(`\n✓ MongoDB MCP Agent Server ready at http://localhost:${port}\n`);
    } catch (error) {
        console.error('\nFATAL: Failed to start server:', error.message);
        process.exit(1);
    }
});
