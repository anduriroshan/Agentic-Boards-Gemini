export interface ChatRequest {
  session_id?: string;
  message: string;
}

export interface SSEEvent {
  event: string;
  data: string;
}

export interface ThinkingEventData {
  node: string;
  message: string;
}

export interface MessageEventData {
  content: string;
}

export interface VisualizationEventData {
  vega_spec: Record<string, unknown>;
  tile_id: string;
}

export interface QueryEventData {
  cube_query: Record<string, unknown>;
  sql: string;
  results: Record<string, unknown>[];
}

export interface MetadataEventData {
  node: string;
  tables: string[];
  measures: Record<string, unknown>[];
}

export interface DoneEventData {
  session_id: string;
}
