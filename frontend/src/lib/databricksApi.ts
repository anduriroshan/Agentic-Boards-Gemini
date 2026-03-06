import type { DatabricksStatus, DatabricksTableConfig, DatabricksQueryResult } from "@/types/databricks";

const API_BASE = "/api";

export async function getDatabricksStatus(): Promise<DatabricksStatus> {
  const res = await fetch(`${API_BASE}/databricks/status`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json();
}

export async function connectDatabricks(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/databricks/connect`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`Connect failed: ${res.status}`);
  return res.json();
}

export async function disconnectDatabricks(): Promise<{ message: string }> {
  const res = await fetch(`${API_BASE}/databricks/disconnect`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Disconnect failed: ${res.status}`);
  return res.json();
}

export async function getDatabricksTableConfig(): Promise<DatabricksTableConfig> {
  const res = await fetch(`${API_BASE}/databricks/table-config`);
  if (!res.ok) throw new Error(`Get table config failed: ${res.status}`);
  return res.json();
}

export async function setDatabricksTableConfig(
  table: string,
  catalog?: string,
  schemaName?: string
): Promise<DatabricksTableConfig & { message: string }> {
  const res = await fetch(`${API_BASE}/databricks/table-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table, catalog, schema_name: schemaName }),
  });
  if (!res.ok) throw new Error(`Set table config failed: ${res.status}`);
  return res.json();
}

export async function listDatabricksTables(
  catalog?: string,
  schema?: string
): Promise<{ tables: string[] }> {
  const params = new URLSearchParams();
  if (catalog) params.set("catalog", catalog);
  if (schema) params.set("schema", schema);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/databricks/tables${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`List tables failed: ${res.status}`);
  return res.json();
}

export async function queryDatabricks(
  sql: string,
  limit = 1000
): Promise<DatabricksQueryResult> {
  const res = await fetch(`${API_BASE}/databricks/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sql, limit }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Query failed: ${res.status}`);
  }
  return res.json();
}

export async function reindexDatabricks(
  catalog?: string,
  schema?: string
): Promise<{ message: string; tables?: string[] }> {
  const params = new URLSearchParams();
  if (catalog) params.set("catalog", catalog);
  if (schema) params.set("schema", schema);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/databricks/schema-cache/warm${qs ? `?${qs}` : ""}`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `Schema cache warm failed: ${res.status}`);
  }
  return res.json();
}
