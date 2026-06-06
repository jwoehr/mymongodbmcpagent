# MongoDB MCP Agent

This Node.js application serves as an intelligent agent that leverages the Google Gemini large language model to interact with a MongoDB MCP server instance. The agent is designed to understand user questions about MongoDB, select the appropriate tool from the MongoDB MCP server, execute it with the correct arguments, and then format the results into a natural, human-readable answer.

## Features

- **Intelligent Tool Selection:** Utilizes Google Gemini to analyze user queries and select the most appropriate MongoDB tool from the available tools provided by the MongoDB MCP server.
- **ReAct Architecture:** Utilizes a Reason + Act (ReAct) loop that allows the agent to autonomously evaluate results and make consecutive tool calls to fulfill a request without user intervention.
- **Skills Package Support:** Supports loading custom skills (markdown-based workflows) from a configured directory to guide the agent in complex, multi-step MongoDB tasks.
- **Fallback to Direct Answer:** If the model cannot determine an appropriate tool to use, it will provide a direct answer based on its general knowledge.
- **Dynamic Tool Execution:** Calls the selected tool on the MongoDB MCP server with the necessary arguments.
- **Natural Language Response:** Formats the JSON or structured data returned by the MongoDB tools into a clear and understandable natural language response.
- **Chat History Context:** Considers conversation history to provide more relevant and accurate answers.
- **MCP Session Management:** Maintains a persistent session with the MongoDB MCP server for reliable communication.
- **Interactive Chat Interface:** Includes a command-line chat client for easy interaction with MongoDB.

## Prerequisites

- Node.js (>=18.0.0) and npm installed.
- Access to a running MongoDB MCP server instance.
- A Google Gemini API key.

## Configuration

Before running the agent, you need to set up the following environment variables. You can create a `.env` file in the root of this directory to store these variables. An example is provided in `.env.example`.

### Required Environment Variables

- `GEMINI_API_KEY`: Your API key for the Google Gemini service.
- `GEMINI_GENERATIVE_MODEL`: The specific Gemini model you want to use (e.g., `gemini-2.0-flash-exp`).
- `MONGODB_MCP_SERVER_URI`: The full URI of the running MongoDB MCP server instance (e.g., `http://localhost:3000/mcp`).

### Optional Environment Variables

- `PORT`: The port on which the agent server will listen. Defaults to `3012`.
- `MAX_ITERATIONS`: The maximum number of agent thought loops allowed to execute per request. Defaults to `5`.
- `MONGODB_AGENT_URL`: The URL for the chat client to connect to. Defaults to `http://localhost:3012`.
- `MONGODB_AGENT_SKILLS_PATH`: Directory path to load custom skills (`SKILL.md` files) to enhance the agent's capabilities.

## Installation

1. Navigate to the `mongodb-agent` directory.
2. Copy the example environment file and configure it:

    ```bash
    cp .env.example .env
    # Edit .env with your actual values
    ```

3. Install the required npm packages:

    ```bash
    npm install
    ```

## Running the Agent

### Starting the Agent Server

To start the agent server, run the following command from within the `mongodb-agent` directory:

```bash
npm start
```

Or directly:

```bash
node agent-server.js
```

Upon successful startup, the agent will fetch the available tools from the MongoDB MCP server and will be ready to accept requests on the configured port (default: 3012).

### Using the Interactive Chat Client

To start an interactive chat session with the MongoDB agent:

```bash
npm run chat
```

Or directly:

```bash
node chat.js
```

The chat interface provides:

- Natural language queries about your MongoDB databases
- Command history and context awareness
- Easy-to-use commands (exit, clear, help)

#### Chat Commands

- Type your MongoDB-related questions naturally
- `exit` or `quit` - End the chat session
- `clear` - Clear chat history
- `help` - Display help message

#### Example Queries

```text
🍃 MongoDB Query> List all databases

🍃 MongoDB Query> Show collections in the sample database

🍃 MongoDB Query> Find documents in the users collection

🍃 MongoDB Query> Get performance statistics for my cluster
```

## Concurrency and Timeouts

The MongoDB agent is designed to handle multiple `POST /chat` requests in parallel safely. It uses a single MCP session protected by a mutex to avoid reconnect storms, and applies limits on outbound API calls.

You can tune these variables in `.env`:

- `LLM_CONCURRENCY` (default: 4): Maximum parallel requests to the LLM (Gemini).
- `MCP_CONCURRENCY` (default: 8): Maximum parallel tool calls sent to the MongoDB MCP server.
- `LLM_TIMEOUT_MS` (default: 60000): Milliseconds before an LLM call aborts.
- `MCP_TIMEOUT_MS` (default: 30000): Milliseconds before an MCP tool call aborts.

### `GET /metrics`

Returns a lightweight JSON object containing the current number of active and pending calls in both the LLM and MCP limiters.

## API Endpoint

### `POST /chat`

This is the main endpoint for interacting with the agent.

**Request Body:**

```json
{
    "question": "Your MongoDB question here",
    "history": []
}
```

- `question` (string, required): The user's question or prompt about MongoDB.
- `history` (array, optional): An array of previous conversation turns to provide context to the model.

**Success Response (200 OK):**

```json
{
    "answer": "The formatted, natural language answer to your MongoDB question."
}
```

**Error Response (500 Internal Server Error):**

```json
{
    "answer": "Sorry, there was an error processing your request."
}
```

## How It Works

1. **Server Initialization:** On startup, the agent establishes a session with the MongoDB MCP server using the MCP protocol initialize handshake.
2. **Tool Discovery:** The agent fetches and caches the list of available MongoDB tools from the MCP server.
3. **Skill Loading:** The agent loads available custom skills from the configured skills path, providing the LLM with complex, multi-step MongoDB workflows.
4. **User Query:** The user submits a question through the `/chat` endpoint or the interactive chat client.
5. **ReAct Loop:** The agent uses a Reason + Act (ReAct) loop with Google Gemini to handle the query. It evaluates the question against available tools and skills, iteratively calling tools, analyzing results, and making consecutive tool calls if needed.
6. **Result Delivery:** Once the agent determines the request is fully satisfied, it formats the final natural language answer and returns it to the user.

## Troubleshooting

- **"Tool list is not available"**: Ensure the MongoDB MCP server is running and accessible at the URI specified in `MONGODB_MCP_SERVER_URI`.
- **Connection Refused**: Verify that the MongoDB MCP server is started and listening on the correct port.
- **Authentication Errors**: Check that your Gemini API key is valid and properly set in the `.env` file.

## Development

The agent consists of two main components:

1. **agent-server.js**: The Express server that handles chat requests and communicates with both Gemini AI and the MongoDB MCP server.
2. **chat.js**: An interactive command-line interface for querying MongoDB using natural language.

## License

ISC
