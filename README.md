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

## 🚀 Getting Started

Agentic Boards uses a unified Docker Compose setup for quick deployment.

1. Ensure Docker, Node.js (≥18), and Python (≥3.11) are installed.
2. Duplicate `.env.example` to `backend/.env` and securely populate your credentials:
   - **LLM Details:** Gemini API Key.
   - **Google OAuth:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.
   - **Databricks:** Host, Token, and Warehouse ID.
3. Run the full stack:
   ```bash
   docker compose up --build
   ```
4. Access the unified application at `https://agentic-boards.live/`.

