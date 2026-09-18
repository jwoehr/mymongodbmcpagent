# Plan: Improve MCP Agent Code Quality, Concurrency, and State Management

## Goal

Improve the production-readiness of the MongoDB MCP Agent by refactoring its state management, resolving a critical race condition in session reconnection, and implementing an automated test suite.

## Context & Problem

The current `agent-server.js` maintains MCP session state (`sessionId`, `availableTools`, `sessionLock`) as module-level global variables. This architecture creates three significant weaknesses:

1. **Race Conditions**: When a session expires and multiple concurrent LLM requests attempt to execute an MCP tool, they all fail simultaneously and trigger the `initializeSession` function. Because the mutex (`sessionLock`) is acquired but doesn't check if the session was *already recovered* by a preceding request, the server falls into a reconnection loop, continuously replacing the active session.
2. **Poor Testability**: Because state is global and side-effects (like `fetch` to the MCP server) are hardcoded, unit testing the reconnection logic or tool fetching is virtually impossible without overly complex network mocking.
3. **No Automated Tests**: The project currently has zero automated tests, making refactoring and future enhancements risky.

## Decisions

1. **State Encapsulation**: Refactor the MCP connection state into a dedicated, stateful `MCPSessionManager` class.
2. **Dependency Injection**: Inject the `fetch` API into the `MCPSessionManager` constructor. This enables trivial mocking of network requests in unit tests.
3. **Race Condition Fix**: Update the `reconnect` logic within the `MCPSessionManager` to capture the `failedSessionId`. After acquiring the mutex lock, the manager will compare the current `this.sessionId` to `failedSessionId`. If they differ, it means another request already successfully reconnected, and the current request can immediately return the new session ID without performing another network handshake.
4. **Testing Framework**: Use **Jest** as the testing framework to validate the `MCPSessionManager` logic natively.

## Task List

### 1. Project Setup

- [ ] Run `npm install --save-dev jest`.
- [ ] Update `package.json` so that the `"test"` script runs `"jest"`.

### 2. Create `MCPSessionManager`

- [ ] Create a new file `mcp-session-manager.js` (either in the root or `shared/` directory).
- [ ] Define the `MCPSessionManager` class with properties: `mcpUrl`, `fetchFn`, `sessionId`, `availableTools`, `formattedToolList`, and `sessionLock`.
- [ ] Implement `initializeSession(reqId)` to perform the MCP handshake using `this.fetchFn`.
- [ ] Implement `fetchTools(reqId)` to populate `this.availableTools`.
- [ ] Implement `callTool(reqId, toolName, toolArguments, failedSessionId = null)`:
  - If a tool fails with a 401/403/404, call `reconnect(reqId, this.sessionId)` and then recursively retry.
- [ ] Implement `reconnect(reqId, failedSessionId)`:
  - Wait for `this.sessionLock`.
  - **Crucial fix**: `if (this.sessionId !== failedSessionId) return this.sessionId;`
  - Re-initialize session and refetch tools.

### 3. Create Unit Tests

- [ ] Create `mcp-session-manager.test.js`.
- [ ] Test 1: Successful initialization and tool fetching.
- [ ] Test 2: Successful tool calling.
- [ ] Test 3: Session expiration triggers a transparent reconnection.
- [ ] Test 4: **Race condition prevention** - Simulate 5 concurrent tool calls failing simultaneously, and assert that the mocked `fetchFn` is only called *once* for the `initialize` handshake.

### 4. Refactor `agent-server.js`

- [ ] Import `MCPSessionManager`.
- [ ] Remove all global MCP variables (`sessionId`, `sessionLock`, `availableTools`, `formattedToolList`) and the related functions (`initializeSession`, `callMCPTool`, `fetchTools`).
- [ ] Instantiate `const mcpManager = new MCPSessionManager(process.env.MONGODB_MCP_SERVER_URI)`.
- [ ] During server startup, call `await mcpManager.initializeSession()` and `await mcpManager.fetchTools()`.
- [ ] Update the `/chat` route's ReAct loop to use `mcpManager.callTool(...)` and `mcpManager.formattedToolList`.

## Validation Plan

1. Run `npm run test` and verify 100% pass rate for the new session manager tests.
2. Ensure the mock assertions prove the race condition is resolved (only 1 reconnect network call for `N` concurrent failures).
3. Start the server (`npm start`) and use the chat client (`npm run chat`) to verify the agent successfully answers a MongoDB question, proving the refactoring hasn't broken end-to-end functionality.
