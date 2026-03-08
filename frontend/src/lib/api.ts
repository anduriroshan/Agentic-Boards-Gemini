const API_BASE = "/api";

export type AgentStepData = {
  step_id: string;
  phase: "thinking" | "call" | "result" | "final";
  agent: string;
  icon: string;
  tool?: string;
  summary: string;
  status: "running" | "done" | "error";
  elapsed_ms?: number;
  ts: number;
};

export type SSEEventHandler = {
  onThinking?: (data: { node: string; message: string }) => void;
  onMessage?: (data: { content: string }) => void;
  onVisualization?: (data: { vega_spec: Record<string, unknown>; tile_id: string; query_meta?: { sql: string; params: Record<string, unknown> } }) => void;
  onUpdateVisualization?: (data: { vega_spec: Record<string, unknown>; tile_id: string }) => void;
  onUpdateLayout?: (data: { layouts: { tile_id: string; x: number; y: number; w: number; h: number }[] }) => void;
  onDataTable?: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[]; query_meta?: { sql: string; params: Record<string, unknown> } }) => void;
  onUpdateDataTable?: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[] }) => void;
  onRemoveTile?: (data: { tile_id: string }) => void;
  onUpdateTileTitle?: (data: { tile_id: string; title: string }) => void;
  onUpdateText?: (data: { tile_id: string; markdown: string }) => void;
  onKpiTile?: (data: { tile_id: string; title: string; value: string; subtitle: string; color: string; sparkline?: number[] }) => void;
  onTextTile?: (data: { tile_id: string; title: string; markdown: string }) => void;
  onQuery?: (data: { cube_query: Record<string, unknown>; sql: string; results: Record<string, unknown>[] }) => void;
  onMetadata?: (data: { node: string; tables: string[]; measures: Record<string, unknown>[] }) => void;
  onError?: (data: { message: string; details?: string }) => void;
  onDone?: (data: { session_id: string }) => void;
  onAgentStep?: (data: AgentStepData) => void;
};

export type TileContext = {
  tile_id: string;
  title: string;
  vega_spec: Record<string, unknown>;
  layout?: { x: number; y: number; w: number; h: number };
};

export type ChatHistoryItem = {
  role: "user" | "assistant";
  content: string;
};

export async function sendChatMessage(
  sessionId: string | null,
  message: string,
  handlers: SSEEventHandler,
  currentTiles?: TileContext[],
  chatHistory?: ChatHistoryItem[],
  llmModel?: string | null,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      message,
      llm_model: llmModel,
      current_tiles: currentTiles ?? [],
      chat_history: chatHistory ?? [],
    }),
    signal,
  });

  if (!response.ok) {
    throw new Error(`Chat request failed: ${response.status}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    let currentEvent = "";
    let currentData = "";

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, ""); // strip \r for \r\n line endings
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData += (currentData ? "\n" : "") + line.slice(5).trim();
      } else if (line === "" && currentEvent && currentData) {
        try {
          const parsed = JSON.parse(currentData);
          switch (currentEvent) {
            case "thinking":
              handlers.onThinking?.(parsed);
              break;
            case "message":
              handlers.onMessage?.(parsed);
              break;
            case "visualization":
              handlers.onVisualization?.(parsed);
              break;
            case "update_visualization":
              handlers.onUpdateVisualization?.(parsed);
              break;
            case "update_layout":
              handlers.onUpdateLayout?.(parsed);
              break;
            case "data_table":
              handlers.onDataTable?.(parsed);
              break;
            case "update_data_table":
              handlers.onUpdateDataTable?.(parsed);
              break;
            case "remove_tile":
              handlers.onRemoveTile?.(parsed);
              break;
            case "update_tile_title":
              handlers.onUpdateTileTitle?.(parsed);
              break;
            case "update_text":
              handlers.onUpdateText?.(parsed);
              break;
            case "kpi_tile":
              handlers.onKpiTile?.(parsed);
              break;
            case "text_tile":
              handlers.onTextTile?.(parsed);
              break;
            case "query":
              handlers.onQuery?.(parsed);
              break;
            case "metadata":
              handlers.onMetadata?.(parsed);
              break;
            case "error":
              handlers.onError?.(parsed);
              break;
            case "done":
              handlers.onDone?.(parsed);
              break;
            case "agent_step":
              handlers.onAgentStep?.(parsed);
              break;
          }
        } catch {
          // Skip malformed JSON
        }
        currentEvent = "";
        currentData = "";
      }
    }
  }
}

export async function healthCheck(): Promise<{ status: string }> {
  const response = await fetch(`${API_BASE}/health`);
  return response.json();
}

/** Re-execute a chart's SQL with optional parameter overrides (live chart support). */
export async function refreshChartData(
  sql: string,
  params: Record<string, unknown> = {},
): Promise<{
  rows: Record<string, unknown>[];
  row_count: number;
  sql: string;
  params: Record<string, { value: number | string; type: string; label: string; min?: number; max?: number; options?: string[] }>;
  error?: string;
}> {
  const response = await fetch(`${API_BASE}/charts/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, params }),
  });
  return response.json();
}
