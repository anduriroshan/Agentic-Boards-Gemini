# Backend Workflow

Detailed flow of the FastAPI backend application.

## Application Startup

```mermaid
flowchart TD
    Start["uvicorn src.main:app<br/>--host 0.0.0.0 --port 8000"]
    --> FastAPI["FastAPI App Init"]
    --> Middleware["Add CORS Middleware<br/>(allow frontend origins)"]
    --> Routers["Register Routers"]

    Routers --> R1["/auth/* (routes_auth)"]
    Routers --> R2["/api/chat (routes_chat)"]
    Routers --> R3["/api/agent/live (routes_live)"]
    Routers --> R4["/databricks/* (routes_databricks)"]
    Routers --> R5["/bigquery/* (routes_bigquery)"]
    Routers --> R6["/workspace/* (routes_workspace)"]
    Routers --> R7["/health (routes_health)"]
    Routers --> R8["/charts/* (routes_charts)"]

    FastAPI --> DBInit["Init SQLite DB<br/>(create tables)"]
    FastAPI --> SPA["Mount SPA<br/>(serve frontend dist)"]
```

## Authentication Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant F as FastAPI
    participant G as Google OAuth
    participant DB as SQLite

    B->>F: GET /auth/google/login
    F->>B: 302 Redirect to Google
    B->>G: User grants consent
    G->>B: 302 Redirect with auth code
    B->>F: GET /auth/google/callback?code=...
    F->>G: Exchange code for token
    G->>F: Access token
    F->>G: GET userinfo (sub, email, name, picture)
    G->>F: User profile
    F->>DB: Upsert User record
    F->>DB: Create Session (token, user_id, expires_at)
    F->>B: Set-Cookie: session_token + Redirect to FRONTEND_URL

    Note over B,F: Subsequent requests
    B->>F: GET /auth/me (Cookie: session_token)
    F->>DB: Validate session token + expiry
    DB->>F: User record
    F->>B: 200 {id, name, email, picture}
```

## Chat API Flow (SSE)

```mermaid
flowchart TD
    Request["POST /api/chat<br/>{message, tiles, chat_history,<br/>database_provider}"]
    --> ValidateSession["Validate session<br/>(cookie or Bearer token)"]
    --> BuildState["Build AgentState:<br/>- messages<br/>- current_tiles<br/>- chat_history<br/>- database_provider"]
    --> InvokeGraph["Invoke LangGraph<br/>(stream mode)"]

    InvokeGraph --> StreamLoop["Stream events loop"]

    StreamLoop --> CheckEvent{"Event type?"}

    CheckEvent -->|"guardrail_result"| GuardEvent["SSE: guardrail status"]
    CheckEvent -->|"agent messages"| AgentEvent["Process tool calls<br/>and responses"]
    CheckEvent -->|"tool results"| ToolEvent["Parse tool output"]

    ToolEvent --> ToolType{"Tool name?"}

    ToolType -->|"search_metadata"| MetaSSE["SSE: metadata<br/>{tables found}"]
    ToolType -->|"execute_sql<br/>execute_bigquery"| QuerySSE["SSE: query<br/>{columns, rows, sql}"]
    ToolType -->|"create_visualization"| VizSSE["SSE: visualization<br/>{vega_spec, tile_id}"]
    ToolType -->|"create_data_table"| TableSSE["SSE: data_table<br/>{columns, rows, tile_id}"]
    ToolType -->|"create_kpi_tile"| KPISSE["SSE: kpi_tile<br/>{value, subtitle, color}"]
    ToolType -->|"modify_dashboard"| LayoutSSE["SSE: update_layout<br/>{tile changes}"]
    ToolType -->|"remove_tiles"| RemoveSSE["SSE: remove_tiles<br/>{tile_ids}"]

    AgentEvent -->|"Each step"| StepSSE["SSE: agent_step<br/>{tool, status, elapsed}"]

    StreamLoop -->|"Graph complete"| DoneSSE["SSE: done<br/>{session_id}"]
```

## WebSocket Live Agent Flow

```mermaid
sequenceDiagram
    participant B as Browser
    participant WS as WebSocket Handler
    participant Coord as LiveSessionState
    participant ADK as Google ADK Agent
    participant Tools as Agent Tools
    participant DW as Data Warehouse

    B->>WS: Connect /api/agent/live
    WS->>Coord: Initialize session state
    WS->>ADK: Create ADK agent with tools

    loop Real-time interaction
        B->>WS: Audio chunk (base64)
        WS->>ADK: Forward audio input

        ADK->>ADK: Speech-to-text + LLM reasoning

        alt Tool call needed
            ADK->>Tools: Execute tool (e.g., execute_sql)
            Tools->>DW: Run query
            DW->>Tools: Results
            Tools->>ADK: Tool response
            ADK->>WS: Tool result event
            WS->>B: WebSocket: tool result JSON
        end

        ADK->>WS: Voice response audio
        WS->>B: WebSocket: audio chunks (base64)
    end

    B->>WS: Disconnect
    WS->>Coord: Cleanup session
```

## Database Schema

```mermaid
erDiagram
    User {
        int id PK
        string google_id UK
        string email
        string name
        string picture
        datetime created_at
        datetime updated_at
    }

    Session {
        int id PK
        string token UK
        int user_id FK
        datetime expires_at
        datetime created_at
    }

    SavedWorkspace {
        int id PK
        int user_id FK
        string name
        json state_json
        datetime created_at
        datetime updated_at
    }

    User ||--o{ Session : "has many"
    User ||--o{ SavedWorkspace : "has many"
```

## API Route Summary

| Route | Method | Protocol | Purpose |
|-------|--------|----------|---------|
| `/auth/google/login` | GET | HTTP | Initiate OAuth |
| `/auth/google/callback` | GET | HTTP | OAuth callback |
| `/auth/me` | GET | HTTP | Current user info |
| `/auth/logout` | POST | HTTP | End session |
| `/api/chat` | POST | SSE | Text chat with agent |
| `/api/agent/live` | WS | WebSocket | Voice chat with agent |
| `/databricks/status` | GET | HTTP | Connection status |
| `/databricks/reindex` | POST | HTTP | Re-index schema in Milvus |
| `/databricks/schema` | GET | HTTP | Get table schema |
| `/bigquery/status` | GET | HTTP | Connection status |
| `/workspace/save` | POST | HTTP | Save dashboard state |
| `/workspace/load` | GET | HTTP | Load saved dashboard |
| `/health` | GET | HTTP | Health check |
