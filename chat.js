#!/usr/bin/env node

const readline = require('readline');
require('dotenv').config();

const AGENT_URL = process.env.MONGODB_AGENT_URL || 'http://localhost:3012';
const chatHistory = [];

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '\n🍃 MongoDB Query> '
});

/**
 * Sends a chat message to the MongoDB agent server
 * @param {string} question - The user's question
 * @returns {Promise<string>} The agent's answer
 */
async function chat(question) {
    try {
        const response = await fetch(`${AGENT_URL}/chat`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                question,
                history: chatHistory,
            }),
        });

        if (!response.ok) {
            throw new Error(`Server responded with status: ${response.status}`);
        }

        const data = await response.json();
        
        // Add to chat history
        chatHistory.push({
            role: 'user',
            parts: [{ text: question }],
        });
        chatHistory.push({
            role: 'model',
            parts: [{ text: data.answer }],
        });

        return data.answer;
    } catch (error) {
        if (error.code === 'ECONNREFUSED') {
            return `Error: Cannot connect to agent server at ${AGENT_URL}. Make sure the agent server is running.`;
        }
        return `Error: ${error.message}`;
    }
}

/**
 * Displays welcome message and instructions
 */
function displayWelcome() {
    console.log('\n╔══════════════════════════════════════════════════════════╗');
    console.log('║          MongoDB Agent Chat Interface                    ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('\nConnected to:', AGENT_URL);
    console.log('(Note: This CLI processes one prompt at a time, but the server handles concurrent requests safely.)');
    console.log('\nCommands:');
    console.log('  - Type your MongoDB-related questions');
    console.log('  - Type "exit" or "quit" to end the session');
    console.log('  - Type "clear" to clear chat history');
    console.log('  - Type "help" to see this message again');
    console.log('\nExamples:');
    console.log('  - "List all databases"');
    console.log('  - "Show collections in the sample database"');
    console.log('  - "Find documents in the users collection"');
    console.log('  - "Get performance statistics"');
}

/**
 * Processes user commands
 * @param {string} input - User input
 * @returns {boolean} True if chat should continue, false to exit
 */
async function processInput(input) {
    const trimmed = input.trim().toLowerCase();

    switch (trimmed) {
        case 'exit':
        case 'quit':
            console.log('\n👋 Goodbye!\n');
            return false;

        case 'clear':
            chatHistory.length = 0;
            console.log('\n✓ Chat history cleared.\n');
            return true;

        case 'help':
            displayWelcome();
            return true;

        case '':
            return true;

        default:
            console.log('\n⏳ Processing...\n');
            const answer = await chat(input);
            console.log('🤖 Answer:', answer);
            return true;
    }
}

/**
 * Main chat loop
 */
async function main() {
    displayWelcome();
    
    rl.prompt();

    rl.on('line', async (line) => {
        const shouldContinue = await processInput(line);
        
        if (!shouldContinue) {
            rl.close();
            process.exit(0);
        }
        
        rl.prompt();
    });

    rl.on('close', () => {
        console.log('\n👋 Chat session ended.\n');
        process.exit(0);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
        console.log('\n\n👋 Chat session interrupted.\n');
        process.exit(0);
    });
}

// Start the chat
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
