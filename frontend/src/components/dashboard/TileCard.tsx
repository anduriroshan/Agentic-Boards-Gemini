import { useCallback, useEffect, useState, useRef } from "react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useFilterStore } from "@/stores/filterStore";
import { refreshChartData } from "@/lib/api";
import VegaChart from "./VegaChart";
import DataTable from "./DataTable";
import KpiTile from "./KpiTile";
import TextTile from "./TextTile";
import TileComments from "./TileComments";
import ChartControls from "./ChartControls";
import TextTileControls from "./TextTileControls";
import KpiTileControls from "./KpiTileControls";
import type { DashboardTile } from "@/types/dashboard";
import type { TopLevelSpec } from "vega-lite";

interface TileCardProps {
  tile: DashboardTile;
  onBringToFront?: () => void;
  onSendToBack?: () => void;
}

/** Replace the data.values in a Vega-Lite spec with fresh rows. */
function updateVegaData(
  spec: TopLevelSpec,
  newRows: Record<string, unknown>[],
): TopLevelSpec {
  const cloned = JSON.parse(JSON.stringify(spec));
  if (cloned.data && typeof cloned.data === "object") {
    cloned.data.values = newRows;
  } else {
    cloned.data = { values: newRows };
  }
  return cloned as TopLevelSpec;
}

export default function TileCard({ tile, onBringToFront, onSendToBack }: TileCardProps) {
  const addKpiTile = useDashboardStore((s) => s.addKpiTile);
  const updateTile = useDashboardStore((s) => s.updateTile);
  const updateTableTile = useDashboardStore((s) => s.updateTableTile);
  const updateTextTile = useDashboardStore((s) => s.updateTextTile);
  const removeTile = useDashboardStore((s) => s.removeTile);
  const updateTileQueryMeta = useDashboardStore((s) => s.updateTileQueryMeta);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showParams, setShowParams] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showTextSettings, setShowTextSettings] = useState(false);
  const [showKpiSettings, setShowKpiSettings] = useState(false);
  const [autoRefreshMs, setAutoRefreshMs] = useState(0);

  const filters = useFilterStore((s) => s.filters);
  const lastFiltersRef = useRef(filters);
  const isInitialMount = useRef(true);

  const hasQueryMeta = !!tile.queryMeta?.sql;
  const params = tile.queryMeta?.params || {};
  const hasParams = Object.keys(params).length > 0;

  const asNumber = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const n = Number(v.replace(/,/g, "").replace(/[$%]/g, ""));
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  const handleRefresh = useCallback(
    async (paramOverrides?: Record<string, unknown>) => {
      if (!tile.queryMeta?.sql) return;
      setIsRefreshing(true);
      try {
        const result = await refreshChartData(
          tile.queryMeta.sql,
          { ...(paramOverrides || {}), type: tile.queryMeta.type },
        );
        if (!result.error && result.rows) {
          // Update the last applied filters filter state
          lastFiltersRef.current = filters;
          
          if (tile.type === "chart" && tile.vegaSpec) {
            updateTile(tile.id, updateVegaData(tile.vegaSpec, result.rows));
          } else if (tile.type === "table") {
            const firstRow = result.rows[0];
            const columns = firstRow
              ? Object.keys(firstRow).map((field) => ({
                field,
                headerName: field,
              }))
              : [];
            updateTableTile(tile.id, { columns, rows: result.rows });
          } else if (tile.type === "kpi" && tile.kpiData) {
            const firstRow = result.rows[0] as Record<string, unknown> | undefined;
            if (firstRow && typeof firstRow === "object") {
              const entries = Object.entries(firstRow);
              const numericEntry = entries.find(([, val]) => asNumber(val) !== null);
              const valueEntry = numericEntry || entries.find(([, val]) => val !== null && val !== undefined);

              let value = tile.kpiData.value;
              if (valueEntry) {
                const raw = valueEntry[1];
                if (typeof raw === "number") {
                  const hasDollarPrefix = tile.kpiData.value.trim().startsWith("$");
                  value = hasDollarPrefix ? `$${raw.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : raw.toLocaleString("en-US");
                } else if (raw !== null && raw !== undefined) {
                  value = String(raw);
                }
              }

              let subtitle = tile.kpiData.subtitle;
              const minDate = firstRow.min_date || firstRow.minDate;
              const maxDate = firstRow.max_date || firstRow.maxDate;
              if (minDate && maxDate) {
                subtitle = `Data from ${minDate} to ${maxDate}`;
              }

              let sparkline = tile.kpiData.sparkline;
              const numericRows = result.rows
                .map((row: Record<string, unknown>) => {
                  if (!numericEntry) return null;
                  return asNumber(row[numericEntry[0]]);
                })
                .filter((n): n is number => n !== null);
              if (numericRows.length > 1) {
                sparkline = numericRows;
              }

              addKpiTile(
                tile.id,
                { ...tile.kpiData, value, subtitle, sparkline },
                tile.title,
                tile.queryMeta,
              );
            }
          }
          if (result.params) {
            updateTileQueryMeta(tile.id, {
              sql: result.sql || tile.queryMeta.sql,
              params: result.params as Record<string, import("@/types/dashboard").QueryParam>,
              type: tile.queryMeta.type,
            });
          }
        }
      } catch (err) {
        console.error("Tile refresh failed:", err);
      } finally {
        setIsRefreshing(false);
      }
    },
    [
      tile.id,
      tile.queryMeta,
      tile.vegaSpec,
      tile.type,
      filters,
      updateTile,
      updateTableTile,
      addKpiTile,
      updateTileQueryMeta,
    ],
  );

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefreshMs <= 0) return;
    const interval = setInterval(() => handleRefresh(), autoRefreshMs);
    return () => clearInterval(interval);
  }, [autoRefreshMs, handleRefresh]);

  // React to global filter changes
  useEffect(() => {
    if (!hasQueryMeta) return;

    // Optimization: Skip refresh on mount if we already have data 
    // AND filters are at their default state (empty/null)
    const hasData =
      tile.type === "chart"
        ? !!(tile.vegaSpec?.data as any)?.values
        : tile.type === "table"
          ? !!tile.tableData?.rows
          : tile.type === "kpi"
            ? !!tile.kpiData?.value
            : false;
    const filtersChanged = JSON.stringify(filters) !== JSON.stringify(lastFiltersRef.current);
    
    if (isInitialMount.current) {
      isInitialMount.current = false;
      // Optimization: Skip initial refresh if we already have data
      if (hasData) {
        lastFiltersRef.current = filters;
        return;
      }
      // If no data, we fall through to perform the initial fetch
    } else if (!filtersChanged) {
      // Periodic check: Only refresh if filters actually changed
      return;
    }

    const overrides: Record<string, unknown> = {};
    if (filters.dateFrom) overrides.date_from = filters.dateFrom;
    if (filters.dateTo) overrides.date_to = filters.dateTo;

    handleRefresh(overrides);
  }, [filters, hasQueryMeta, handleRefresh]);

  return (
    <div
      className="bg-white/80 backdrop-blur-md rounded-lg border border-white/40 shadow-lg overflow-hidden"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-white/30 bg-white/50 shrink-0">
        <div className="tile-drag-handle flex-1 cursor-move truncate">
          <h3 className="text-sm font-medium truncate">{tile.title}</h3>
        </div>
        <div className="flex items-center gap-1 ml-2">
          {onBringToFront && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onBringToFront();
              }}
              className="text-sm px-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Bring Forward"
            >
              ↑
            </button>
          )}
          {onSendToBack && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSendToBack();
              }}
              className="text-sm px-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Send Backward"
            >
              ↓
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setShowComments(!showComments);
            }}
            className={`text-sm px-1 transition-colors relative ${showComments ? "text-primary" : "text-muted-foreground hover:text-foreground"
              }`}
            title="Comments"
          >
            💬
            {(tile.comments?.length ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                {tile.comments!.length}
              </span>
            )}
          </button>
          {hasQueryMeta && (
            <>
              {hasParams && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowParams(!showParams);
                  }}
                  className={`text-sm px-1 transition-colors ${showParams
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                    }`}
                  title="Chart Parameters"
                >
                  ⚙
                </button>
              )}
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleRefresh();
                }}
                disabled={isRefreshing}
                className={`text-sm px-1 text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors ${isRefreshing ? "animate-spin" : ""
                  }`}
                title="Refresh Data"
              >
                ↻
              </button>
              {tile.type === "kpi" && (
                <button
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowKpiSettings(!showKpiSettings);
                  }}
                  className={`text-sm px-1 transition-colors ${showKpiSettings ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                  title="KPI Text Size"
                >
                  A
                </button>
              )}
            </>
          )}
          {autoRefreshMs > 0 && (
            <span
              className="text-[10px] text-green-500 px-1"
              title={`Auto-refreshing every ${autoRefreshMs / 1000}s`}
            >
              ●
            </span>
          )}
          {tile.type === "text" && (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                setShowTextSettings(!showTextSettings);
              }}
              className={`text-sm px-1 transition-colors ${showTextSettings ? "text-primary" : "text-muted-foreground hover:text-foreground"
                }`}
              title="Text Settings"
            >
              ⚙
            </button>
          )}
          <button
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              removeTile(tile.id);
            }}
            className="text-muted-foreground hover:text-destructive text-sm px-1 ml-1 z-10"
            title="Remove tile"
          >
            &times;
          </button>
        </div>
      </div>

      {/* ── Comments Panel (collapsible) ──────────────────────── */}
      {showComments && (
        <TileComments
          tileId={tile.id}
          comments={tile.comments || []}
        />
      )}

      {/* ── Parameter Panel (collapsible) ──────────────────────── */}
      {showParams && hasParams && (
        <ChartControls
          params={params}
          autoRefreshMs={autoRefreshMs}
          onAutoRefreshChange={setAutoRefreshMs}
          onApply={(overrides) => handleRefresh(overrides)}
          isRefreshing={isRefreshing}
        />
      )}

      {/* ── Text Settings Panel (collapsible) ──────────────────── */}
      {showTextSettings && tile.type === "text" && tile.textData && (
        <TextTileControls
          currentFontSize={tile.textData.fontSize}
          onApply={(fontSize) => updateTextTile(tile.id, tile.textData!.markdown, fontSize)}
        />
      )}

      {/* ── KPI Settings Panel (collapsible) ───────────────────── */}
      {showKpiSettings && tile.type === "kpi" && tile.kpiData && (
        <KpiTileControls
          currentFontSize={tile.kpiData.fontSize}
          onApply={(fontSize) =>
            addKpiTile(
              tile.id,
              { ...tile.kpiData!, fontSize },
              tile.title,
              tile.queryMeta,
            )}
        />
      )}

      {/* ── Content ─────────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {tile.type === "kpi" && tile.kpiData ? (
          <KpiTile title={tile.title} kpiData={tile.kpiData} />
        ) : tile.type === "text" && tile.textData ? (
          <TextTile
            data={tile.textData}
            onUpdate={(md) => updateTextTile(tile.id, md, tile.textData?.fontSize)}
          />
        ) : tile.type === "table" && tile.tableData ? (
          <DataTable
            columns={tile.tableData.columns}
            rows={tile.tableData.rows}
          />
        ) : tile.vegaSpec ? (
          <div className="p-2 w-full h-full">
            <VegaChart spec={tile.vegaSpec} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
