const API_BASE = "/api";

export interface BigQueryStatus {
  connected: boolean;
  project_id: string;
  default_table: string;
}

export async function getBigQueryStatus(): Promise<BigQueryStatus> {
  const res = await fetch(`${API_BASE}/bigquery/status`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status}`);
  return res.json();
}

export async function connectBigQuery(): Promise<BigQueryStatus> {
  const res = await fetch(`${API_BASE}/bigquery/connect`, {
    method: "POST",
  });
  if (!res.ok) throw new Error(`Connect failed: ${res.status}`);
  return res.json();
}

export async function setBigQueryTableConfig(
  table: string
): Promise<{ message: string; default_table: string }> {
  const res = await fetch(`${API_BASE}/bigquery/table-config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ table }),
  });
  if (!res.ok) throw new Error(`Set table config failed: ${res.status}`);
  return res.json();
}

export async function listBigQueryTables(
  dataset?: string
): Promise<{ tables: string[] }> {
  const params = new URLSearchParams();
  if (dataset) params.set("dataset", dataset);
  const qs = params.toString();
  const res = await fetch(`${API_BASE}/bigquery/tables${qs ? `?${qs}` : ""}`);
  if (!res.ok) throw new Error(`List tables failed: ${res.status}`);
  return res.json();
}
