# Agentic Boards - Conversational Business Intelligence

Conversational BI Platform for Enterprise Data Analytics  
**Live Demo:** [agentic-boards.live](https://agentic-boards.live)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Python 3.11+](https://img.shields.io/badge/Python-3.11+-blue.svg)](https://www.python.org/downloads/)
[![React 19](https://img.shields.io/badge/React-19-61dafb.svg)](https://react.dev)
[![LangGraph](https://img.shields.io/badge/LangGraph-Agent%20Orchestration-1f3937.svg)](https://github.com/langchain-ai/langgraph)
[![LangChain](https://img.shields.io/badge/LangChain-Framework-2ea44f.svg)](https://www.langchain.com/)
[![Google ADK](https://img.shields.io/badge/Google%20ADK-Agent%20Dev%20Kit-4285F4.svg)](https://github.com/google/generative-ai-python)

**[Website](https://agentic-boards.live) • [Documentation](#getting-started) • [Report Issue](https://github.com) • [Contribute](https://github.com)**

---

**Agentic Boards** is a conversational Business Intelligence platform that generates interactive dashboards from natural language queries. Instead of navigating static dashboards, users ask questions in plain English and the system finds data, writes SQL, executes queries, and creates visualizations in real-time.

Built with the Google Agent Development Kit (ADK), LangGraph ReAct agents, and Gemini Live API, Agentic Boards searches your Databricks and BigQuery schemas using semantic embeddings (Milvus). It generates SQL queries, executes them, and streams the agent's reasoning and results to your browser so you can see every step.

---

## Features

### Natural Language Analytics
Ask questions in plain English like "Show me top 10 products by sales in May as a donut chart." The system discovers relevant tables via semantic search, generates SQL, executes queries, and creates interactive visualizations. 

### AI-Powered Dashboard Generation
Every chart, table, and layout is generated on-demand by AI agents. The system chooses visualization types (bar, line, pie, scatter), encodes data dimensions, and responds to your queries in real-time.

### Real-Time Agent Transparency
Watch AI agents think in real-time via WebSocket streaming. The **Agent Activity Panel** shows every step: which tables are being searched, what SQL is being generated, which tools are executing, and how data is being transformed into visualizations.

### Multi-Tenant Workspaces
Google OAuth 2.0 enables secure multi-user access, with each user maintaining isolated dashboards, chat history, and session state. Role-based data access through your warehouse security policies.

### Persistent Analysis & History
All dashboards, charts, and conversations are persisted in a backend database, not temporary browser storage. Your analytical work follows you across devices and browsers, with full chat history and dashboard snapshots available for reference.

---

## Dashboard Capabilities

The Agentic Boards dashboard combines AI-driven generation with manual control:

- **Responsive Grid Layout:** 12-column drag-and-drop grid similar to Notion/Excel for organizing insights
- **Visualizations:** Bar, line, area, pie, scatter, and more automatically chosen based on your data
- **Interactive Data Tables:** Column formatting, null/NaN handling, pageable results
- **KPI Cards:** Metric tiles with spark lines and thresholds
- **AI-Driven Editing:** Modify tiles with natural language commands like "Add a bar graph showing top products by revenue" or "Change the color of this card"
- **Contextual AI Reasoning:** Agents analyze existing tiles to answer questions without re-querying
- **Multi-Warehouse Context:** Query Databricks and BigQuery in the same session with automatic provider switching

---

## The Agent System

Agentic Boards uses a multi-layered agent architecture combining the Google Agent Development Kit (ADK) with LangGraph ReAct agents. The system supports both real-time streaming (via Gemini Live API) and traditional ReAct orchestration, with semantic schema discovery via Milvus vector embeddings.

### DataAgent
Responsible for finding and querying enterprise data.
* **Capabilities:** Searches Databricks and BigQuery schemas using semantic + keyword search (via Milvus embeddings), discovers relevant tables and columns, generates dialect-specific SQL, validates queries for safety (read-only enforcement), and executes with automatic provider switching.

### VizAgent
Transforms raw data into interactive visual insights.
* **Capabilities:** Analyzes data shapes to select visualization types (bar, line, area, pie, scatter, table), encodes data dimensions, generates Vega-Lite specifications and interactive React tables, handles null/NaN/Infinity values, and creates KPI metric cards.

### DashboardAgent
Manages spatial layout and presentation of insights.
* **Capabilities:** Modifies dashboard tiles based on natural language ("Make this wider", "Move to top"), updates chart specs/colors/titles, repositions/resizes tiles on the 12-column grid, manages layout state, and removes components on command.

### Orchestrator Agent
Coordinates high-level analysis and meta-reasoning.
* **Capabilities:** Answers questions about previous actions ("What have you done?"), accesses session history and dashboard snapshots, reasons over existing tiles without re-querying, and manages multi-step workflows.

---

## Technology Stack

| Component | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Zustand, Vega-Lite, Tailwind CSS |
| **Backend** | FastAPI (Python 3.13), LangGraph, LangChain, SQLAlchemy |
| **LLM Engines** | Gemini (Live API & Batch), OpenAI, Vertex AI |
| **Agent Framework** | Google Agent Development Kit (ADK) + LangGraph ReAct |
| **Authentication** | Google OAuth 2.0 (Authlib) |
| **Session Database** | SQLite (Users, Chat History, Dashboards) |
| **Data Warehouses** | Databricks (SQL Warehouse / Spark) & BigQuery |
| **Schema Search** | Milvus (Vector Embeddings), Semantic + Keyword |
| **Visualization** | Vega-Lite, Interactive Tables, KPI Cards |

---

---

## Prerequisites

Before you can run Agentic Boards, ensure you have:

### System Requirements
- **Docker & Docker Compose** — [Install Docker Desktop](https://www.docker.com/products/docker-desktop) (includes Docker Compose)
- **Node.js** (≥18) — [Download here](https://nodejs.org/)
- **Python** (≥3.11) — [Download here](https://www.python.org/downloads/)
- **Git** — [Download here](https://git-scm.com/)

### Accounts & Credentials You'll Need
To run Agentic Boards, you need **four things**:

1. **GCP Service Account** — Provides access to Gemini via Vertex AI
2. **Google OAuth Credentials** — Allows users to sign in with their Google account
3. **Databricks Account & Credentials** — The cloud data warehouse where your data lives
4. **GCP Project** — Google Cloud infrastructure (with Vertex AI API enabled)

**Time estimate to set up credentials: ~15-20 minutes.**

---

## Step-by-Step Credential Setup

### Step 1: Create a Google Cloud Project (5 min)

**Why you need this:** Google Cloud is where you'll create both your GCP project and OAuth credentials. Think of it as a container for all your Google services.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the **project dropdown** at the top (currently says "Select a project")
3. Click **NEW PROJECT**
4. Enter name: `agentic-boards` (or any name you like)
5. Click **CREATE** and wait ~30 seconds for it to initialize
6. Select your newly created project from the dropdown

**What you'll use later:** Your **Project ID** (visible in the project selector)

---

### Step 2: Enable Required APIs (3 min)

**Why you need this:** APIs are like "plugins" that let your app talk to Google services. You need to turn these on.

1. In Google Cloud Console, search for **"Vertex AI API"** in the search bar
2. Click on the result → Click **ENABLE**
3. Repeat this for:
   - **BigQuery API** (for querying data)
   - **IAM API** (for service account access)

*(These are the core APIs needed for local setup)*

---

### Step 3: Create a GCP Service Account (5 min)

**What is this?** A service account is a special Google Cloud account that lets your application access Vertex AI (and Gemini through it). Think of it as a password that proves your app is authorized.

**Where to get it:**

1. Go back to [Google Cloud Console](https://console.cloud.google.com/)
2. In the left sidebar, click **IAM & Admin** → **Service Accounts**
3. Click **Create Service Account**
4. Fill in:
   - **Service account name:** `agentic-boards`
   - **Service account ID:** auto-generated (leave as-is)
5. Click **Create and Continue**
6. On the next page, click **Grant this service account access to project**
7. Add these roles:
   - **Vertex AI User** (for Gemini access)
   - **BigQuery Admin** (for BigQuery access)
8. Click **Continue** then **Done**
9. Back on the Service Accounts list, click your new service account
10. Click the **Keys** tab
11. Click **Add Key** → **Create new key**
12. Choose **JSON** and click **Create**
13. A JSON file will download — **Save this file in your `backend/` folder as `service_account.json`**

**Where it goes in config:** This becomes your `GCP_SERVICE_ACCOUNT` (path to the JSON file) in the `.env` file.

---

### Step 4: Set Up Google OAuth (5 min)

**What is this?** OAuth is a secure way to let users sign into your app using their Google account (like "Sign in with Google" buttons you see everywhere). This prevents you from storing passwords.

**Where to get it:**

1. Go back to [Google Cloud Console](https://console.cloud.google.com/)
2. In the left sidebar, click **APIs & Services** → **Credentials**
3. Click **Create Credentials** → **OAuth 2.0 Client ID**
4. If prompted "Configure OAuth consent screen first":
   - Click **Configure Consent Screen**
   - Choose **External** (for testing)
   - Click **Create**
   - Fill in:
     - **App name:** `Agentic Boards`
     - **User support email:** Your email
     - **Developer contact:** Your email
   - Click **SAVE AND CONTINUE** (skip optional sections)
5. Back on the Credentials page, click **Create Credentials** → **OAuth 2.0 Client ID** again
6. Choose **Web application**
7. Under **Authorized redirect URIs**, click **ADD URI** and enter:
   ```
   http://localhost:8001/auth/callback
   ```
8. Click **CREATE**
9. A popup shows your credentials:
   - Copy the **Client ID**
   - Copy the **Client Secret**
   - Save both somewhere safe

**Where they go:** These become `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`.

---

### Step 5: Create a Databricks Account & Credentials (5 min)

**What is Databricks?** Databricks is a cloud platform where data is stored. Agentic Boards reads from your Databricks database and generates visualizations.

**Free Option:** Databricks offers a free community tier ([create account here](https://www.databricks.com/try-databricks)). You can test with sample data they provide.

**To get your credentials:**

1. Log in to your Databricks workspace
2. Click your **username** (top-right) → **Settings**
3. Click **Developer** → **Access tokens**
4. Click **Generate new token**
5. Set expiration to a long time (e.g., 90 days)
6. Click **GENERATE**
7. **Copy the token immediately** and save it (you won't see it again)
8. This becomes your `DATABRICKS_TOKEN`

**Get your Workspace URL:**
1. Look at your browser's URL bar — it looks like: `https://adb-1234567890.cloud.databricks.com/`
2. Copy just the hostname part: `adb-1234567890.cloud.databricks.com`
3. This becomes your `DATABRICKS_HOST`

**Get your SQL Warehouse HTTP Path:**
1. In Databricks, click **SQL Warehouses** (left sidebar)
2. Open any warehouse (or create one if you don't have one)
3. Click the **Connection details** tab
4. Copy the **HTTP path** (looks like: `/sql/1.0/warehouses/abc123`)
5. This becomes your `DATABRICKS_HTTP_PATH`

**Where they go:** These become `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, and `DATABRICKS_HTTP_PATH` in `.env`.

---

## Quick Start: Docker Compose (Easiest - 2 minutes)

Now that you have all your credentials, let's run the application.

### 1. Create Your Configuration File

```bash
# From the project root directory
cp .env.example backend/.env
```

### 2. Edit the Configuration

Open `backend/.env` in your text editor and fill in these fields with the values you collected:

```env
# ── LLM (from Step 3 - Vertex AI via Service Account) ──
GCP_PROJECT_ID=<your-gcp-project-id-from-step-1>
GCP_REGION=us-central1
GCP_SERVICE_ACCOUNT=service_account.json
GOOGLE_APPLICATION_CREDENTIALS=service_account.json

# ── Google OAuth (from Step 4) ──
GOOGLE_CLIENT_ID=<your-client-id-here>
GOOGLE_CLIENT_SECRET=<your-client-secret-here>
GOOGLE_REDIRECT_URI=http://localhost:8001/auth/callback
FRONTEND_URL=http://localhost:8001

# ── Databricks (from Step 5) ──
DATABRICKS_HOST=<your-workspace-url-here>        # e.g., adb-1234567890.cloud.databricks.com
DATABRICKS_TOKEN=<your-token-here>
DATABRICKS_HTTP_PATH=<your-http-path-here>       # e.g., /sql/1.0/warehouses/abc123
DATABRICKS_CATALOG=main                           # Usually 'main' for sample data
DATABRICKS_SCHEMA=default                         # Usually 'default' for sample data
DATABRICKS_DEFAULT_TABLE=<optional>               # Leave blank if unsure

# ── Backend Database ──
DATABASE_URL=sqlite+aiosqlite:///./data/agentic_bi.db
SESSION_SECRET=your-secret-key-change-this-in-production

# ── Milvus (Vector Search - Already Configured) ──
MILVUS_URI=./data/milvus_data.db
MILVUS_ENABLED=true
```

**Tip:** If you don't know the Databricks catalog/schema name, use `main` and `default` — they're the defaults.

### 3. Run with Docker Compose

```bash
docker compose up --build
```

The first run will take 2-3 minutes as it downloads and builds the containers.

**Look for this line in the output:**
```
app_1  | INFO:     Uvicorn running on http://0.0.0.0:8000
```

### 4. Access the Application

Open your browser and go to:
```
http://localhost:8001
```

You should see the Agentic Boards login screen. Sign in with your Google account!

---

## Local Development Setup

If you want to develop or debug the frontend and backend separately:

### Backend Setup

```bash
cd backend

# Create Python virtual environment
python3.11 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start backend server (watches for code changes)
uvicorn src.main:app --reload --port 8000
```

Backend will run at `http://localhost:8000`

### Frontend Setup (in a new terminal)

```bash
cd frontend

# Install dependencies
npm install

# Start development server (with hot-reload)
npm run dev
```

Frontend will run at `http://localhost:5173`

### Access the Application

In your browser, navigate to:
```
http://localhost:5173
```

The frontend automatically proxies API calls to `http://localhost:8000`.

## Troubleshooting

### "Authentication Failed" or "401 Unauthorized"

**Cause:** Google OAuth credentials are incorrect or misconfigured.

**Fix:**
1. Double-check `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `backend/.env`
2. Verify `GOOGLE_REDIRECT_URI=http://localhost:8001/auth/callback` is exactly correct
3. In Google Cloud, make sure this redirect URI is in your credentials' authorized list
4. Restart the app: `docker compose down && docker compose up --build`

---

### "Connection Refused" or "Cannot Connect to Databricks"

**Cause:** Databricks credentials are wrong or warehouse is not running.

**Fix:**
1. Double-check your `DATABRICKS_HOST` — it should look like `adb-1234567890.cloud.databricks.com`
   - **Wrong:** `https://adb-1234567890.cloud.databricks.com/` (includes https:// and /)
   - **Correct:** `adb-1234567890.cloud.databricks.com`
2. Verify your `DATABRICKS_TOKEN` is copied correctly (no extra spaces)
3. In Databricks, make sure your SQL Warehouse is powered on (check the Warehouses page)
4. Check that the HTTP path is correct — should look like `/sql/1.0/warehouses/abc123def`

---

### "Module Not Found" or "Package Not Installed"

**Cause:** Dependencies weren't installed properly.

**Fix:**

**For Docker:**
```bash
docker compose down
docker compose up --build  # Force rebuild
```

**For local development:**
```bash
# Backend
cd backend
pip install -r requirements.txt --upgrade

# Frontend
cd frontend
npm install
```

---

### "Port 8000 Already in Use" or "Port 8001 Already in Use"

**Cause:** Another application is using that port.

**Fix:**

**Option 1:** Stop the conflicting application

**Option 2:** Change the port in `docker-compose.yml`:
```yaml
services:
  app:
    ports:
      - "9001:8000"  # Change 8001 to 9001 (or any free port)
```

Then access at `http://localhost:9001`

---

### "Permission Denied" or "Service Account Cannot Access Vertex AI"

**Cause:** Service account doesn't have the correct roles, or the JSON key file is missing/corrupted.

**Fix:**
1. Verify `service_account.json` exists in your `backend/` folder
2. In Google Cloud Console, go to **IAM & Admin** → **Service Accounts**
3. Click your `agentic-boards` service account
4. Click **Roles** tab and verify it has:
   - **Vertex AI User** (for Gemini access)
   - **BigQuery Admin** (for BigQuery access)
5. If roles are missing, click **Add Role** and add them
6. If the JSON file is corrupted, regenerate it:
   - Go to **Keys** tab
   - Delete the old key
   - Click **Add Key** → **Create new key** → **JSON**
   - Replace the JSON file in your `backend/` folder
7. Restart the app: `docker compose down && docker compose up --build`

---

### "Database is Locked" (SQLite error)

**Cause:** Multiple instances are accessing the database simultaneously.

**Fix:**
```bash
# Stop all containers
docker compose down

# Clear the database (fresh start)
rm -rf data/

# Start again
docker compose up --build
```

---

### Everything Works but No Data Shows Up

**Cause:** Your data warehouse (Databricks or BigQuery) has no tables, or the connection isn't configured.

**For Databricks:**
1. Log into your Databricks workspace
2. Click **Catalog** → check if you have tables
3. If you have tables, pick a table name and update `DATABRICKS_DEFAULT_TABLE` in `backend/.env`
   - Example: `DATABRICKS_DEFAULT_TABLE=main.default.my_table_name`
4. Make sure your SQL Warehouse is powered on
5. Restart the app: `docker compose down && docker compose up --build`

**For BigQuery:**
1. Log into [Google Cloud Console](https://console.cloud.google.com/)
2. Go to **BigQuery** and create a dataset or load sample data into an existing dataset
3. Update your `backend/.env` with:
   - `BIGQUERY_PROJECT_ID=<your-gcp-project-id>`
   - `BIGQUERY_DATASET=<your-dataset-name>`
4. Make sure your service account has `Big Query Admin` role (you already did this in Step 3 of setup)
5. Restart the app: `docker compose down && docker compose up --build`

---

## Additional Resources

- [Databricks Documentation](https://docs.databricks.com/) — Learn Databricks syntax and features
- [Vertex AI Documentation](https://cloud.google.com/vertex-ai/docs) — Vertex AI and Gemini API setup
- [Google Cloud OAuth Setup](https://developers.google.com/identity/protocols/oauth2) — Technical OAuth details
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) — Agent architecture internals

---

## Deployment

For production deployment to Google Cloud Run, see [GCP_DEPLOYMENT.md](GCP_DEPLOYMENT.md).

For additional local deployment options, see [LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md).

---

## License

This project is licensed under the [LICENSE](LICENSE) file in the repository.

