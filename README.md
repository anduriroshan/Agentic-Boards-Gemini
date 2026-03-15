# Agentic Boards

**Agentic Boards** is a conversational Business Intelligence (BI) platform that transforms how you interact with your enterprise data. Rather than relying on static, pre-built dashboards, Agentic Boards allows users to generate instant, data-driven visualizations and insights using natural language.

Powered by a ReAct agent architecture (LangGraph) and large language models, the platform securely connects to Databricks to discover schema metadata, execute optimized SQL queries, and stream interactive visualizations directly back to your browser in real time.

---

## ✨ Features

### Conversational BI
Simply type natural language questions (e.g., *"Show me top 10 products by sales in May as a donut chart"*) and watch as the system dynamically builds the necessary data pipelines and generates the visualization. 

### No Pre-built Dashboards
Every chart, table, and layout is generated on-demand. Agentic Boards provides a flexible canvas that adapts to your analytical needs instantly.

### Real-Time Streaming & Transparency
The platform leverages Server-Sent Events (SSE) to stream the agent's thought processes directly to the UI. The **Agent Activity Panel** provides a transparent, live view of the decision-making process, showing exactly how your question is being answered step-by-step.

### 🔐 Secure Multi-User Access
Agentic Boards now features full **Google OAuth 2.0 Integration**, allowing multiple users to sign in and maintain their own private environments.

### 💾 Persistent Workspaces
Unlike many BI tools that rely on temporary browser storage, Agentic Boards persists your **Dashboards and Chat History** in a backend SQLite database. This ensures your work is saved securely and follows you across different devices and browsers.

---

## 📊 Dashboard Capabilities

The Agentic Boards dashboard is designed to be highly interactive and customizable:

- **Dynamic Grid Layout:** A responsive, drag-and-drop 12-column grid layout lets you organize your insights exactly how you want.
- **Interactive Visualizations:** Renders beautiful, responsive charts using Vega-Lite (bar, line, arc, etc.) and interactive data tables.
- **Session Management:** Save, update, and manage multiple workspace sessions. Easily switch between different analytical contexts or start fresh with a "New Session".
- **AI-Driven Modifications:** Want to change a chart? Just ask the AI to resize it, move it, change its type, or update its title.
- **Contextual Reasoning:** The AI can answer analytical questions ("What are the key insights?") by reasoning over the data already present on the dashboard.
- **Databricks Integration:** Features an easy-to-use settings modal to configure your connection, switch catalogs and schemas.

---

## 🤖 The Agent System

At the core of Agentic Boards is a sophisticated LLM-powered ReAct agent system. The orchestrator delegates tasks to specialized sub-agents based on the user's request:

### 🔍 DataAgent
The **DataAgent** is responsible for understanding your enterprise data.
* **Capabilities:** Connects to Databricks, discovers relevant tables and columns using semantic/keyword search, and generates optimized, dialect-specific SQL queries to extract exactly what is needed.

### 📈 VizAgent
The **VizAgent** transforms raw data into actionable visual insights.
* **Capabilities:** Evaluates data shapes and generates rich, responsive Vega-Lite chart specifications and interactive React data tables. It handles complex data mappings to ensure visual accuracy.

### 🎨 DashboardAgent
The **DashboardAgent** manages the spatial layout and presentation of your insights.
* **Capabilities:** Modifies the dashboard based on natural language commands. It can resize tiles, reposition elements, update chart types, rename headers, and selectively remove components from the canvas.

---

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Zustand, Vega-Lite, Tailwind CSS |
| **Backend** | FastAPI (Python 3.13), LangGraph, LangChain, SQLAlchemy |
| **Authentication** | Google OAuth 2.0 (Authlib) |
| **Database** | SQLite (for Users, Sessions, and Workspaces) |
| **Data Warehouse** | Databricks (PySpark / Databricks Connect) |
| **Vector Store & ML** | Milvus, `sentence-transformers` |

---

---

## 📋 Prerequisites

Before you can run Agentic Boards, ensure you have:

### System Requirements
- **Docker & Docker Compose** — [Install Docker Desktop](https://www.docker.com/products/docker-desktop) (includes Docker Compose)
- **Node.js** (≥18) — [Download here](https://nodejs.org/)
- **Python** (≥3.11) — [Download here](https://www.python.org/downloads/)
- **Git** — [Download here](https://git-scm.com/)

### Accounts & Credentials You'll Need
To run Agentic Boards, you need **four things**:

1. **Gemini API Key** — Enables the AI engine to understand questions and generate SQL
2. **Google OAuth Credentials** — Allows users to sign in with their Google account
3. **Databricks Account & Credentials** — The cloud data warehouse where your data lives
4. **GCP Project** — Google Cloud infrastructure for additional services

**Time estimate to set up credentials: ~15-20 minutes.**

---

## 🔐 Step-by-Step Credential Setup

### Step 1: Create a Google Cloud Project (5 min)

**Why you need this:** Google Cloud is where you'll create both your Gemini API key and OAuth credentials. Think of it as a container for all your Google services.

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click the **project dropdown** at the top (currently says "Select a project")
3. Click **NEW PROJECT**
4. Enter name: `agentic-boards` (or any name you like)
5. Click **CREATE** and wait ~30 seconds for it to initialize
6. Select your newly created project from the dropdown

**What you'll use later:** Your **Project ID** (visible in the project selector)

---

### Step 2: Enable Required APIs (5 min)

**Why you need this:** APIs are like "plugins" that let your app talk to Google services. You need to turn these on.

1. In Google Cloud Console, search for **"Cloud Logging API"** in the search bar
2. Click on the result → Click **ENABLE**
3. Repeat this for:
   - **VertexAI API**
   - **BigQuery API**
   - **BigQuery Connection API**
   - **Artifact Registry API**

*(Don't worry if you don't use all of these — they're needed for the full feature set)*

---

### Step 3: Get Your Gemini API Key (3 min)

**What is this?** Your Gemini API key is a secret password that lets Agentic Boards use Google's AI (similar to how Netflix uses a password to verify you're a real customer).

**Where to get it:**

1. Go to [Google AI Studio](https://aistudio.google.com/)
2. Click **Get API Key** (top-right corner)
3. Click **Create API Key in new Google Cloud project**
4. A popup will show your key — **Copy it and save it somewhere safe** (you'll need it in 10 minutes)
5. Keep this page open for now

**Where it goes in config:** This becomes your `GEMINI_API_KEY` in the `.env` file.

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

**What is Databricks?** Databricks is a cloud platform where your company stores data (like a giant Excel but much more powerful). Agentic Boards reads from your Databricks database and generates charts.

**Note:** Databricks offers a **free community tier** ([create account here](https://www.databricks.com/try-databricks)). You can test with sample data they provide.

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

### Step 6: Set GCP Project ID (1 min)

From your Google Cloud Console:
1. Click the **project dropdown** at the top
2. Copy the **Project ID** (not the project name)
3. This becomes your `GCP_PROJECT_ID` in `.env`

---

## ⚡ Quick Start: Docker Compose (Easiest - 2 minutes)

Now that you have all your credentials, let's run the application.

### 1. Create Your Configuration File

```bash
# From the project root directory
cp .env.example backend/.env
```

### 2. Edit the Configuration

Open `backend/.env` in your text editor and fill in these fields with the values you collected:

```env
# ── LLM (from Step 3) ──
GEMINI_API_KEY=<your-gemini-api-key-here>
GCP_PROJECT_ID=<your-gcp-project-id-from-step-6>
GCP_REGION=us-central1

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

**💡 Tip:** If you don't know the Databricks catalog/schema name, use `main` and `default` — they're the defaults.

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

## 🛠️ Local Development Setup (Alternative - for developers)

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

---

## 📁 Project Structure

```
Agentic-Boards-Gemini/
├── backend/                    # Python FastAPI server
│   ├── src/
│   │   ├── main.py            # API entry point
│   │   ├── config.py          # Settings (reads from .env)
│   │   ├── agent/             # LLM agent orchestration
│   │   ├── api/               # REST API routes
│   │   ├── databricks/        # Databricks connection & query
│   │   ├── metadata/          # Schema caching & vector search
│   │   └── ...
│   ├── pyproject.toml         # Python dependencies
│   └── .env                   # Configuration (you create this)
│
├── frontend/                   # React TypeScript app
│   ├── src/
│   │   ├── main.tsx           # App entry point
│   │   ├── App.tsx            # Main component
│   │   ├── components/        # UI components
│   │   ├── stores/            # Zustand state management
│   │   └── ...
│   ├── package.json           # JS dependencies
│   └── vite.config.ts         # Build configuration
│
├── docker-compose.yml         # Multi-container orchestration
├── .env.example               # Template for configuration
└── README.md                  # This file
```

---

## 🐛 Troubleshooting

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

### "API Key Invalid" or "403 Permission Denied"

**Cause:** Your Gemini API key is incorrect or expired.

**Fix:**
1. Go back to [Google AI Studio](https://aistudio.google.com/)
2. Click **API key** → Create a new one
3. Copy the new key to `GEMINI_API_KEY` in `backend/.env`
4. Restart the app

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

**Cause:** Your Databricks warehouse has no tables, or the default table isn't configured.

**Fix:**
1. Log into your Databricks workspace
2. Click **Catalog** → check if you have tables
3. Pick a table name and update `DATABRICKS_DEFAULT_TABLE` in `backend/.env`
4. Example: `DATABRICKS_DEFAULT_TABLE=main.default.my_table_name`
5. Restart the app

---

## 📚 Additional Resources

- [Databricks Documentation](https://docs.databricks.com/) — Learn Databricks syntax and features
- [Google AI Studio Guide](https://support.google.com/aistudio/answer/13824549) — Gemini API help
- [Google Cloud OAuth Setup](https://developers.google.com/identity/protocols/oauth2) — Technical OAuth details
- [LangGraph Documentation](https://langchain-ai.github.io/langgraph/) — Agent architecture internals

---

## 🚀 Deployment

For production deployment to Google Cloud Run, see [GCP_DEPLOYMENT.md](GCP_DEPLOYMENT.md).

For additional local deployment options, see [LOCAL_DEPLOYMENT.md](LOCAL_DEPLOYMENT.md).

---

## 📝 License

This project is licensed under the [LICENSE](LICENSE) file in the repository.

