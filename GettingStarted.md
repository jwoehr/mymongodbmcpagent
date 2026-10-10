# Getting started

This guide walks you through every step required to fully use the MongoDB MCP
Agent: installing and configuring the MongoDB MCP server, installing the MongoDB
agent skills package, configuring this project, and launching everything.

## Prerequisites

- [Node.js](https://nodejs.org/) v18 or later and npm installed.
- A running MongoDB instance or MongoDB Atlas cluster.
- An LLM provider account or local installation (see
  [Choose an LLM provider](#2-choose-an-llm-provider)).

---

## Phase 1: Install and configure the MongoDB MCP server

The agent communicates with MongoDB through the official
[MongoDB MCP server](https://github.com/mongodb/mongodb-mcp-server). The MCP
server exposes your MongoDB instance as a set of tools over HTTP.

### 1.1 Install the MongoDB MCP server

```bash
npm install -g @mongodb-js/mongodb-mcp-server
```

### 1.2 Configure the MongoDB MCP server

The MCP server reads its connection string from an environment variable or from
command-line flags. The simplest way is to export the connection string before
starting the server:

```bash
export MDB_MCP_CONNECTION_STRING="mongodb://localhost:27017"
```

For MongoDB Atlas, use a full SRV connection string:

```bash
export MDB_MCP_CONNECTION_STRING="mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
```

### 1.3 Start the MongoDB MCP server

By default the server listens on port `3000` and exposes tools at the path
`/mcp`.

```bash
mongodb-mcp-server --transport http --port 3000
```

Leave this terminal running. Verify the server is up by requesting the health
endpoint:

```bash
curl -s http://localhost:3000/mcp
```

A valid response (even an empty or error JSON body) confirms the server is
reachable.

---

## Phase 2: Install the MongoDB agent skills package

The [MongoDB agent-skills](https://github.com/mongodb/agent-skills) package
provides pre-built Markdown skill files (`SKILL.md`) that teach the agent
complex, multi-step MongoDB workflows such as index optimization, schema
analysis, and performance tuning. Skills are optional but strongly recommended.

### 2.1 Clone the skills repository

Clone the repository to a location of your choice. This guide uses
`~/mongodb-agent-skills` as the target directory:

```bash
git clone https://github.com/mongodb/agent-skills ~/mongodb-agent-skills
```

### 2.2 Locate the skills directory

After cloning, the individual skill files live under the `skills/` subdirectory:

```bash
ls ~/mongodb-agent-skills/skills/
```

Each subdirectory under `skills/` contains a `SKILL.md` file that the agent
loads at startup. You will point `MONGODB_AGENT_SKILLS_PATH` to this directory
in the next phase.

---

## Phase 3: Configure this project

### 3.1 Install dependencies

Navigate to this project directory and install the core dependencies:

```bash
npm install
```

Then install the package for your chosen LLM provider (install only one):

```bash
# Google Gemini
npm install @google/generative-ai

# Ollama (local, free)
npm install ollama

# OpenAI
npm install openai

# Anthropic Claude
npm install @anthropic-ai/sdk
```

### 3.2 Choose an LLM provider

| Provider             | Cost     | Privacy                | Notes                                                                     |
| -------------------- | -------- | ---------------------- | ------------------------------------------------------------------------- |
| **Google Gemini**    | Paid API | Data sent to Google    | Get a key at [Google AI Studio](https://makersuite.google.com/app/apikey) |
| **Ollama**           | Free     | Fully local            | Requires [Ollama](https://ollama.com) installed locally                   |
| **OpenAI**           | Paid API | Data sent to OpenAI    | Get a key at [OpenAI Platform](https://platform.openai.com/api-keys)      |
| **Anthropic Claude** | Paid API | Data sent to Anthropic | Get a key at [Anthropic Console](https://console.anthropic.com/)          |

#### Ollama setup (local provider only)

If you choose Ollama, install it and pull a model before continuing:

```bash
# Install Ollama (macOS and Linux)
curl -fsSL https://ollama.com/install.sh | sh

# Start the Ollama server
ollama serve

# Pull a recommended model (in a second terminal)
ollama pull llama3.1:8b
```

### 3.3 Create your `.env` file

Copy the example file and open it in your editor:

```bash
cp .env.example .env
```

The minimum required settings are shown below. Uncomment and fill in only the
block that matches your chosen provider.

```bash
# ── Required ─────────────────────────────────────────────────────────────────

# Address of the MongoDB MCP server started in Phase 1
MONGODB_MCP_SERVER_URI=http://localhost:3000/mcp

# Pick exactly one provider: gemini | ollama | openai | anthropic
LLM_PROVIDER=gemini

# ── Google Gemini ─────────────────────────────────────────────────────────────
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-pro

# ── Ollama (uncomment if LLM_PROVIDER=ollama) ─────────────────────────────────
# OLLAMA_BASE_URL=http://localhost:11434
# OLLAMA_MODEL=llama3.1:8b

# ── OpenAI (uncomment if LLM_PROVIDER=openai) ─────────────────────────────────
# OPENAI_API_KEY=your_openai_api_key_here
# OPENAI_MODEL=gpt-4o

# ── Anthropic (uncomment if LLM_PROVIDER=anthropic) ───────────────────────────
# ANTHROPIC_API_KEY=your_anthropic_api_key_here
# ANTHROPIC_MODEL=claude-3-5-sonnet-20241022

# ── Skills (set to the skills/ subdirectory cloned in Phase 2) ────────────────
MONGODB_AGENT_SKILLS_PATH=~/mongodb-agent-skills/skills

# ── Optional tuning ───────────────────────────────────────────────────────────
# PORT=3012
# MAX_ITERATIONS=5
# LLM_CONCURRENCY=4
# MCP_CONCURRENCY=8
# LLM_TIMEOUT_MS=60000
# MCP_TIMEOUT_MS=30000
```

> **Tip:** Expand the tilde (`~`) to an absolute path if your shell does not
> expand it inside `.env` files — for example,
> `/home/yourname/mongodb-agent-skills/skills`.

---

## Phase 4: Launch everything

You need three things running: the MongoDB instance, the MCP server, and the
agent server. Use separate terminals for each long-running process.

### Terminal 1 — MongoDB (skip if already running)

If you are using a local MongoDB instance and it is not yet running:

```bash
mongod --dbpath /data/db
```

Atlas users have no action here; the cluster is already available in the cloud.

### Terminal 2 — MongoDB MCP server

```bash
export MDB_MCP_CONNECTION_STRING="mongodb://localhost:27017"
mongodb-mcp-server --transport http --port 3000
```

Wait until you see output confirming the server is listening before proceeding.

### Terminal 3 — MongoDB MCP Agent server

```bash
npm start
```

Successful startup looks like this:

```text
╔══════════════════════════════════════════════════════════╗
║          MongoDB MCP Agent Server                        ║
╚══════════════════════════════════════════════════════════╝

Server starting at http://localhost:3012
LLM Provider: gemini
Model: gemini-2.5-pro
[Skills] Loaded skill: index-optimization
[Skills] Loaded skill: schema-analysis
[Skills] Successfully loaded 2 skills.
✓ MongoDB MCP Agent Server ready at http://localhost:3012
```

### Terminal 4 — Interactive chat client

With the agent server running, start the chat interface in a fourth terminal:

```bash
npm run chat
```

You can then ask MongoDB questions in natural language:

```text
🍃 MongoDB Query> List all databases

🍃 MongoDB Query> Show collections in the sample database

🍃 MongoDB Query> Find slow queries in the logs collection

🍃 MongoDB Query> Suggest indexes for the orders collection
```

Type `help` for a list of built-in commands, `clear` to reset conversation
history, and `exit` or `quit` to end the session.

---

## Verify the setup

Use `curl` to confirm the agent server responds correctly:

```bash
curl -s -X POST http://localhost:3012/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "List all databases", "history": []}' | jq .
```

A successful response returns:

```json
{
  "answer": "The available databases are: ..."
}
```

Check live concurrency metrics at any time:

```bash
curl -s http://localhost:3012/metrics | jq .
```

---

## Troubleshooting

| Symptom                           | Cause                            | Fix                                                                                                    |
| --------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `Tool list is not available`      | MCP server unreachable           | Confirm the MCP server is running and `MONGODB_MCP_SERVER_URI` matches its address.                    |
| `Connection Refused` on port 3000 | MCP server not started           | Run `mongodb-mcp-server --transport http --port 3000` in a separate terminal.                          |
| `Provider "X" is not available`   | LLM package not installed        | Run `npm install <package>` for your chosen provider (see [Phase 3](#phase-3-configure-this-project)). |
| `Missing required variable`       | `.env` not configured            | Copy [`.env.example`](.env.example) to `.env` and fill in all required values.                         |
| Skills not loading                | Wrong path or tilde not expanded | Set `MONGODB_AGENT_SKILLS_PATH` to an absolute path pointing to the `skills/` directory.               |
| Ollama timeouts                   | Model not downloaded             | Run `ollama pull <model>` and wait for the download to complete before starting the agent.             |
