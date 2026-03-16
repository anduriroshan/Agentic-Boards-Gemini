# Agentic Workflow

Detailed flow of the AI agent orchestration layer.

## LangGraph ReAct Agent Graph

```mermaid
flowchart TD
    Entry["__start__<br/>AgentState arrives"]
    --> Guardrail["guardrail node<br/>Classify request scope"]

    Guardrail --> GCheck{"guardrail_result?"}

    GCheck -->|"OUT_OF_SCOPE"| Refusal["Return refusal message<br/>(polite decline)"]
    Refusal --> End1["__end__"]

    GCheck -->|"IN_SCOPE"| Agent["agent node<br/>LLM with bound tools"]

    Agent --> HasTools{"Response has<br/>tool_calls?"}

    HasTools -->|"No tools"| TextResponse["Return text response<br/>to user"]
    TextResponse --> End2["__end__"]

    HasTools -->|"Yes, tool_calls"| ToolNode["tools node<br/>Execute all tool calls<br/>in parallel"]

    ToolNode --> Agent

    style Guardrail fill:#f9e2af
    style Agent fill:#89b4fa
    style ToolNode fill:#a6e3a1
    style Refusal fill:#f38ba8
```

## Agent State Management

```mermaid
flowchart LR
    subgraph Input["Input to Agent"]
        Msg["messages<br/>(LLM conversation)"]
        Tiles["current_tiles<br/>(dashboard context)"]
        History["chat_history<br/>(user-visible chat)"]
        Provider["database_provider<br/>(bigquery | databricks)"]
        Model["llm_model<br/>(optional override)"]
    end

    subgraph SystemPrompt["System Prompt Construction"]
        Base["REACT_SYSTEM_PROMPT<br/>(tool rules, formatting)"]
        Context["Dashboard context<br/>(tile summaries + data rows)"]
        ProviderFlag["Provider flag:<br/>[ACTIVE CONNECTION: X]"]
    end

    Input --> SystemPrompt
    SystemPrompt --> LLM["LLM<br/>(Gemini / OpenAI)"]
```

## Tool Execution Flow

```mermaid
flowchart TD
    subgraph Discovery["1. Schema Discovery"]
        SearchMeta["search_metadata(query)"]
        --> MilvusQuery["Milvus vector search<br/>(cosine similarity)"]
        --> TableResults["Returns: table names,<br/>columns, measures, dimensions"]
    end

    subgraph Query["2. Data Querying"]
        ExecSQL["execute_sql(sql)<br/>(Databricks)"]
        --> DBConn["Databricks SQL Connector<br/>or Spark Cluster"]
        --> SQLResults["Returns: columns, rows<br/>(up to 500 rows)"]

        ExecBQ["execute_bigquery(sql)<br/>(BigQuery)"]
        --> BQClient["BigQuery Client"]
        --> BQResults["Returns: columns, rows"]
    end

    subgraph Viz["3. Visualization Creation"]
        CreateViz["create_visualization(<br/>title, vega_spec, query_meta)"]
        --> ValidateSpec["Validate Vega-Lite spec<br/>(must include data.values)"]
        --> TileID1["Generate tile_id<br/>Return to frontend"]

        CreateKPI["create_kpi_tile(<br/>title, value, subtitle, color)"]
        --> TileID2["Generate tile_id<br/>Return to frontend"]

        CreateTable["create_data_table(<br/>title, columns, rows)"]
        --> TileID3["Generate tile_id<br/>Return to frontend"]

        CreateText["create_text_tile(<br/>title, content)"]
        --> TileID4["Generate tile_id<br/>Return to frontend"]
    end

    subgraph Modify["4. Dashboard Modification"]
        ModDash["modify_dashboard(<br/>spec_updates, layout_updates,<br/>title_updates, kpi_updates)"]
        --> ApplyChanges["Apply changes to<br/>existing tiles by ID"]

        RemTiles["remove_tiles(tile_ids)"]
        --> DeleteTiles["Remove tiles<br/>from dashboard"]
    end

    subgraph DataAccess["5. Data Access"]
        GetSchema["get_bigquery_schema(<br/>table_name)"]
        --> SchemaInfo["Returns: column names<br/>+ data types"]

        GetTileData["get_tile_data(tile_id)"]
        --> TileInfo["Returns: full tile data<br/>for analysis"]
    end

    Discovery -->|"Table identified"| Query
    Query -->|"Data retrieved"| Viz
```

## Typical Agent Reasoning Chain

```mermaid
sequenceDiagram
    participant U as User
    participant G as Guardrail
    participant A as Agent (LLM)
    participant T as Tools
    participant M as Milvus
    participant DB as Data Warehouse
    participant FE as Frontend

    U->>G: "Show me monthly revenue trends"
    G->>G: Classify: IN_SCOPE (data analysis)
    G->>A: Pass to agent

    Note over A: LLM reasons: need to find revenue data

    A->>T: search_metadata("monthly revenue")
    T->>M: Vector similarity search
    M->>T: sales_transactions table (revenue, date columns)
    T->>A: Table schema results

    Note over A: LLM reasons: write SQL for monthly aggregation

    A->>T: execute_bigquery("SELECT DATE_TRUNC(date, MONTH)...")
    T->>DB: Run SQL query
    DB->>T: 24 rows of monthly data
    T->>A: Query results (columns + rows)
    A-->>FE: SSE: agent_step (querying)

    Note over A: LLM reasons: create line chart visualization

    A->>T: create_visualization({mark: "line", encoding: {x: "month", y: "revenue"}})
    T->>A: tile_id: "tile-abc123"
    A-->>FE: SSE: visualization (vega spec)

    Note over A: LLM reasons: done, summarize

    A->>FE: SSE: text response "Here's your monthly revenue trend..."
    A->>FE: SSE: done
```

## Guardrail Classification

```mermaid
flowchart TD
    Input["User message"]
    --> LLMClassify["LLM classifies:<br/>Is this a data/analytics question?"]

    LLMClassify --> Result{"Classification"}

    Result -->|"IN_SCOPE"| Proceed["Proceed to agent<br/>(data analysis, visualization,<br/>dashboard management)"]

    Result -->|"OUT_OF_SCOPE"| Refuse["Polite refusal<br/>with reason"]

    subgraph InScope["In-Scope Examples"]
        IS1["'Show me sales data'"]
        IS2["'Create a bar chart of revenue'"]
        IS3["'What tables are available?'"]
        IS4["'Remove that chart'"]
        IS5["'Make it a pie chart instead'"]
    end

    subgraph OutOfScope["Out-of-Scope Examples"]
        OS1["'Write me a poem'"]
        OS2["'What's the weather?'"]
        OS3["'Help me with my homework'"]
    end
```

## LLM Provider Selection

```mermaid
flowchart TD
    Config["LLM_MODE env var"]

    Config -->|"gemini (default)"| GeminiCheck{"GCP_PROJECT_ID<br/>set?"}

    GeminiCheck -->|"Yes"| VertexAI["ChatVertexAI<br/>(Vertex AI endpoint)"]
    GeminiCheck -->|"No"| APIKeyCheck{"GEMINI_API_KEY<br/>set?"}

    APIKeyCheck -->|"Yes"| GeminiDirect["ChatGoogleGenerativeAI<br/>(Direct API)"]
    APIKeyCheck -->|"No"| Error["Error: No credentials"]

    Config -->|"openai"| OpenAICheck{"OPENAI_API_KEY<br/>set?"}

    OpenAICheck -->|"Yes"| OpenAI["ChatOpenAI"]
    OpenAICheck -->|"No"| Error2["Error: No API key"]
```

## Google ADK Agent (Voice/Multimodal)

```mermaid
flowchart TD
    WSConnect["WebSocket connection<br/>established"]
    --> InitADK["Initialize ADK Agent<br/>with tools + system prompt"]
    --> SessionStart["Start live session<br/>(Multimodal Live API)"]

    subgraph LiveLoop["Real-Time Loop"]
        AudioIn["Receive audio chunk<br/>from client"]
        --> STT["Speech-to-Text<br/>(Gemini built-in)"]
        --> AgentReason["Agent reasoning<br/>(same tools as LangGraph)"]

        AgentReason --> ToolCall{"Tool call?"}

        ToolCall -->|"Yes"| ExecTool["Execute tool"]
        ExecTool --> Summarize{"Result > 32k tokens?"}
        Summarize -->|"Yes"| SummarizeResult["LLM summarizes<br/>tool output"]
        Summarize -->|"No"| PassResult["Pass full result"]
        SummarizeResult --> AgentReason
        PassResult --> AgentReason

        ToolCall -->|"No"| TTS["Text-to-Speech<br/>(Gemini built-in)"]
        TTS --> AudioOut["Send audio chunks<br/>to client"]
        AudioOut --> AudioIn
    end

    subgraph ContextSync["Dashboard Context Sync"]
        FrontendState["Frontend sends<br/>tile state periodically"]
        --> InjectContext["Inject as system<br/>message to agent"]
    end

    SessionStart --> LiveLoop
    ContextSync --> LiveLoop
```
