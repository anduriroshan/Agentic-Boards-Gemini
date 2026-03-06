export interface DatabricksStatus {
  connected: boolean;
  connecting: boolean;
  connected_at: number | null;
  catalog: string;
  schema: string;
  default_table: string;
  spark_version: string | null;
}

export interface DatabricksTableConfig {
  catalog: string;
  schema: string;
  default_table: string;
}

export interface DatabricksQueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
  row_count: number;
}
