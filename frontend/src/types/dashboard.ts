import type { TopLevelSpec } from "vega-lite";

export type TileType = "chart" | "table" | "kpi" | "text";

export interface TextData {
  markdown: string;
  fontSize?: string;
}

export interface KpiData {
  value: string;
  subtitle: string;
  color: string;
  sparkline?: number[];
  fontSize?: string;
}

export interface TableData {
  columns: { field: string; headerName: string }[];
  rows: Record<string, unknown>[];
}

export interface QueryParam {
  value: number | string;
  type: "number" | "select";
  label: string;
  min?: number;
  max?: number;
  options?: string[];
}

export interface QueryMeta {
  sql: string;
  params: Record<string, QueryParam>;
  type?: "bigquery" | "databricks";
}

export interface Comment {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface DashboardTile {
  id: string;
  title: string;
  type: TileType;
  vegaSpec?: TopLevelSpec;
  tableData?: TableData;
  kpiData?: KpiData;
  textData?: TextData;
  queryMeta?: QueryMeta;
  comments?: Comment[];
  layout: TileLayout;
}

export interface TileLayout {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
