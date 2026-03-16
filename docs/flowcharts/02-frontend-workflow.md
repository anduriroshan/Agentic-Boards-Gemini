# Frontend Workflow

Detailed flow of the React frontend application.

## Application Initialization

```mermaid
flowchart TD
    Start["main.tsx<br/>React.createRoot()"]
    --> App["App.tsx<br/>ErrorBoundary + AuthProvider"]
    --> AuthCheck{"AuthContext:<br/>GET /api/auth/me"}

    AuthCheck -->|"401 / No session"| LoginPage["Login.tsx<br/>Google Sign-In Button"]
    AuthCheck -->|"200 / User found"| AppShell["AppShell.tsx<br/>Main Layout"]

    LoginPage -->|"Click Sign In"| OAuthRedirect["Redirect to<br/>/auth/google/login"]
    OAuthRedirect -->|"After OAuth callback"| AuthCheck

    AppShell --> PanelLayout["ResizablePanelGroup<br/>(3 Panels)"]

    PanelLayout --> LeftPanel["Left Panel<br/>AgentActivity"]
    PanelLayout --> CenterPanel["Center Panel<br/>DashboardCanvas"]
    PanelLayout --> RightPanel["Right Panel<br/>ChatPanel"]
```

## Chat Flow (Text Input)

```mermaid
flowchart TD
    UserInput["User types message<br/>in ChatPanel"]
    --> SendMsg["chatStore.sendMessage()"]
    --> SSERequest["POST /api/chat<br/>(SSE stream)"]
    --> StreamEvents["Process SSE Events"]

    StreamEvents --> E1["event: thinking<br/>→ Show reasoning"]
    StreamEvents --> E2["event: metadata<br/>→ Table discovery info"]
    StreamEvents --> E3["event: query<br/>→ SQL results (rows/cols)"]
    StreamEvents --> E4["event: visualization<br/>→ Vega-Lite spec"]
    StreamEvents --> E5["event: data_table<br/>→ Table tile data"]
    StreamEvents --> E6["event: kpi_tile<br/>→ KPI card data"]
    StreamEvents --> E7["event: agent_step<br/>→ Activity log entry"]
    StreamEvents --> E8["event: update_layout<br/>→ Tile position changes"]
    StreamEvents --> E9["event: error<br/>→ Toast notification"]
    StreamEvents --> E10["event: done<br/>→ Session complete"]

    E4 -->|"addVisualizationCallback"| DashStore["dashboardStore<br/>.addTile()"]
    E5 -->|"dataTableCallback"| DashStore
    E6 -->|"kpiTileCallback"| DashStore
    E8 -->|"updateLayoutCallback"| DashStore
    E7 --> AgentStore["agentStore<br/>.addStep()"]

    DashStore --> Rerender["DashboardCanvas<br/>re-renders grid"]
    AgentStore --> ActivityPanel["AgentActivity<br/>updates steps"]
```

## Chat Flow (Voice Input)

```mermaid
flowchart TD
    MicButton["User clicks microphone<br/>in ChatPanel"]
    --> LiveAgent["LiveAgent.tsx<br/>WebSocket connection"]
    --> WSConnect["WebSocket:<br/>/api/agent/live"]

    subgraph AudioPipeline["Audio Pipeline"]
        MicCapture["Microphone capture<br/>(Web Audio API)"]
        --> AudioChunks["Base64 audio chunks"]
        --> WSSend["Send via WebSocket"]
    end

    subgraph Hooks["LiveAgent Hooks"]
        UseAudio["useAudioPlayback<br/>(model voice output)"]
        UseContext["useContextSync<br/>(dashboard state → agent)"]
        UseTools["useToolHandler<br/>(process tool calls)"]
    end

    WSConnect --> AudioPipeline
    WSConnect --> Hooks

    UseTools -->|"Tool results"| DashStore["dashboardStore"]
    UseTools -->|"Activity events"| AgentStore["agentStore"]
    UseAudio -->|"PCM audio"| Speaker["Audio playback<br/>to user"]

    UseContext -->|"Sync tiles + filters"| WSConnect
```

## Dashboard Rendering

```mermaid
flowchart TD
    DashStore["dashboardStore.tiles[]"]
    --> Canvas["DashboardCanvas.tsx<br/>react-grid-layout"]
    --> GridLayout["ResponsiveGridLayout<br/>12-column grid"]

    GridLayout --> TileCard1["TileCard wrapper"]
    GridLayout --> TileCard2["TileCard wrapper"]
    GridLayout --> TileCardN["TileCard wrapper..."]

    TileCard1 --> TypeCheck{"tile.type?"}

    TypeCheck -->|"vega"| VegaChart["VegaChart.tsx<br/>Vega-Embed renders<br/>Vega-Lite spec"]
    TypeCheck -->|"table"| DataTable["DataTable.tsx<br/>TanStack React Table<br/>Sortable columns"]
    TypeCheck -->|"kpi"| KpiTile["KpiTile.tsx<br/>Metric + subtitle<br/>+ optional sparkline"]
    TypeCheck -->|"text"| TextTile["TextTile.tsx<br/>ReactMarkdown<br/>+ rehype-sanitize"]

    VegaChart -->|"Rendered"| Display["User sees<br/>interactive dashboard"]
    DataTable --> Display
    KpiTile --> Display
    TextTile --> Display
```

## State Management Architecture

```mermaid
flowchart LR
    subgraph Stores["Zustand Stores"]
        CS["chatStore<br/>- messages[]<br/>- sendMessage()<br/>- callbacks"]
        DS["dashboardStore<br/>- tiles[]<br/>- layouts{}<br/>- addTile()<br/>- updateTile()<br/>- removeTile()"]
        AS["agentStore<br/>- steps[]<br/>- addStep()<br/>- clearSteps()"]
        SS["sessionStore<br/>- sessions[]<br/>- activeSession"]
        FS["filterStore<br/>- filters{}<br/>- setFilter()"]
        DBS["databricksStore<br/>- status<br/>- tables[]"]
        BQS["bigqueryStore<br/>- status<br/>- config"]
        TS["toastStore<br/>- toasts[]<br/>- addToast()"]
    end

    subgraph Components["React Components"]
        CP["ChatPanel"]
        DC["DashboardCanvas"]
        AA["AgentActivity"]
        DSS["DataSourceSelector"]
        Toast["Toast"]
    end

    CS --> CP
    DS --> DC
    AS --> AA
    DBS --> DSS
    BQS --> DSS
    TS --> Toast

    CS -->|"tile callbacks"| DS
```
