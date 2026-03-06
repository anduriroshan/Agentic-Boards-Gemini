import { useState, useEffect, useCallback, type ChangeEvent } from "react";
import { useDatabricksStore } from "@/stores/databricksStore";
import { cn } from "@/lib/utils";

export default function DatabricksSettings() {
  const {
    status,
    tables,
    loading,
    reindexing,
    reindexMessage,
    error,
    fetchStatus,
    connect,
    disconnect,
    fetchTables,
    updateTableConfig,
    reindex,
    clearError,
  } = useDatabricksStore();

  const [catalog, setCatalog] = useState("");
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");
  const [isOpen, setIsOpen] = useState(false);

  // Fetch status on mount
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Sync local state from status
  useEffect(() => {
    if (status) {
      setCatalog(status.catalog || "");
      setSchema(status.schema || "");
      setTable(status.default_table || "");
    }
  }, [status]);

  const handleSaveTable = useCallback(() => {
    if (table.trim()) {
      updateTableConfig(table.trim(), catalog.trim() || undefined, schema.trim() || undefined);
    }
  }, [table, catalog, schema, updateTableConfig]);

  const handleLoadTables = useCallback(() => {
    fetchTables(catalog || undefined, schema || undefined);
  }, [catalog, schema, fetchTables]);

  const connectedColor = status?.connected
    ? "bg-green-500"
    : status?.connecting
    ? "bg-yellow-500 animate-pulse"
    : "bg-red-500";

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium border hover:bg-muted transition-colors"
        title="Databricks Settings"
      >
        <span className={cn("h-2 w-2 rounded-full", connectedColor)} />
        <span className="hidden sm:inline">Databricks</span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-96 rounded-lg border bg-card shadow-lg">
          <div className="p-4 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Databricks Connection
              </h3>
              <button
                onClick={() => setIsOpen(false)}
                className="text-muted-foreground hover:text-foreground text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Status badge */}
            <div className="flex items-center gap-2 text-xs">
              <span className={cn("h-2 w-2 rounded-full", connectedColor)} />
              <span className="text-muted-foreground">
                {status?.connected
                  ? `Connected (Spark ${status.spark_version})`
                  : status?.connecting
                  ? "Connecting… (this takes 2-3 min)"
                  : "Disconnected"}
              </span>
            </div>

            {/* Connect / Disconnect buttons */}
            <div className="flex gap-2">
              {!status?.connected ? (
                <button
                  onClick={connect}
                  disabled={loading || status?.connecting}
                  className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {status?.connecting ? "Connecting…" : "Connect"}
                </button>
              ) : (
                <button
                  onClick={disconnect}
                  disabled={loading}
                  className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  Disconnect
                </button>
              )}
            </div>

            {/* Divider */}
            <hr className="border-border" />

            {/* Table configuration */}
            <div className="space-y-3">
              <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Database Configuration
              </h4>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Catalog
                  </label>
                  <input
                    type="text"
                    value={catalog}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setCatalog(e.target.value)}
                    placeholder="variance"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">
                    Schema
                  </label>
                  <input
                    type="text"
                    value={schema}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => setSchema(e.target.value)}
                    placeholder="analysis_2"
                    className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted-foreground mb-1">
                  Default Table
                </label>
                <input
                  type="text"
                  value={table}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setTable(e.target.value)}
                  placeholder="variance.analysis_2.gold_variancesummary_03"
                  className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>

              {/* Browse tables (only when connected) */}
              {status?.connected && (
                <div>
                  <button
                    onClick={handleLoadTables}
                    className="text-xs text-primary hover:underline"
                  >
                    Browse tables in {catalog || "catalog"}.{schema || "schema"}
                  </button>
                  {tables.length > 0 && (
                    <div className="mt-2 max-h-32 overflow-y-auto rounded border bg-background">
                      {tables.map((t) => (
                        <button
                          key={t}
                          onClick={() => setTable(t)}
                          className={cn(
                            "w-full text-left px-2 py-1 text-xs hover:bg-muted transition-colors",
                            t === table && "bg-muted font-medium"
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleSaveTable}
                disabled={!table.trim() || loading}
                className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                Save Configuration
              </button>

              {/* Warm schema cache — only when connected */}
              {status?.connected && (
                <div className="space-y-1">
                  <button
                    onClick={() => reindex(catalog || undefined, schema || undefined)}
                    disabled={reindexing}
                    className="w-full rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-50 transition-colors"
                  >
                    {reindexing ? "Loading schema…" : "Refresh Schema Cache"}
                  </button>
                  <p className="text-xs text-muted-foreground">
                    Runs automatically on first query. Click only after adding new tables.
                  </p>
                  {reindexMessage && !reindexing && (
                    <p className="text-xs text-green-600">{reindexMessage}</p>
                  )}
                </div>
              )}
            </div>

            {/* Error display */}
            {error && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 text-xs text-destructive flex justify-between items-start">
                <span>{error}</span>
                <button onClick={clearError} className="ml-2 font-bold">
                  &times;
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
