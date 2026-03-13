import { useState, useEffect, useCallback, type ChangeEvent } from "react";
import { useBigQueryStore } from "@/stores/bigqueryStore";
import { cn } from "@/lib/utils";

interface BigQuerySettingsProps {
  embedded?: boolean;
}

export default function BigQuerySettings({ embedded = false }: BigQuerySettingsProps) {
  const {
    status,
    tables,
    loading,
    error,
    fetchStatus,
    connect,
    fetchTables,
    updateTableConfig,
    clearError,
  } = useBigQueryStore();

  const [dataset, setDataset] = useState("");
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
      if (status.default_table) {
        setTable(status.default_table);
        const parts = status.default_table.split(".");
        if (parts.length >= 2) {
          setDataset(parts[parts.length - 2] || "");
        }
      }
    }
  }, [status]);

  const handleSaveTable = useCallback(() => {
    if (table.trim()) {
      updateTableConfig(table.trim());
    }
  }, [table, updateTableConfig]);

  const handleLoadTables = useCallback(() => {
    fetchTables(dataset || undefined);
  }, [dataset, fetchTables]);

  const connectedColor = status?.connected
    ? "bg-green-500"
    : "bg-slate-400";

  const content = (
    <div className="p-4 space-y-4">
      {/* Header */}
      {!embedded && (
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            BigQuery Connection
          </h3>
          <button
            onClick={() => setIsOpen(false)}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            &times;
          </button>
        </div>
      )}

      {/* Status badge */}
      <div className="flex items-center gap-2 text-xs">
        <span className={cn("h-2 w-2 rounded-full", connectedColor)} />
        <span className="text-muted-foreground">
          {status?.connected
            ? `Authenticated (Project: ${status.project_id})`
            : "Not Connected"}
        </span>
      </div>

      {/* Connect button */}
      {!status?.connected && (
        <div className="flex gap-2">
          <button
            onClick={connect}
            disabled={loading}
            className="flex-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {loading ? "Connecting..." : "Connect"}
          </button>
        </div>
      )}

      {/* Divider */}
      <hr className="border-border" />

      {/* Table configuration */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Table Configuration
        </h4>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Dataset ID
          </label>
          <input
            type="text"
            value={dataset}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDataset(e.target.value)}
            placeholder="e.g. iowa_liquor_retail_sales"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        <div>
          <label className="block text-xs text-muted-foreground mb-1">
            Default Table
          </label>
          <input
            type="text"
            value={table}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTable(e.target.value)}
            placeholder="project-id.dataset.table"
            className="w-full rounded-md border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>

        {/* Browse tables */}
        <div>
          <button
            onClick={handleLoadTables}
            className="text-xs text-primary hover:underline"
          >
            Browse tables in {dataset || "dataset"}
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

        <button
          onClick={handleSaveTable}
          disabled={!table.trim() || loading}
          className="w-full rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          Save Configuration
        </button>
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
  );

  if (embedded) return content;

  return (
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium border hover:bg-muted transition-colors"
        title="BigQuery Settings"
      >
        <span className={cn("h-2 w-2 rounded-full", connectedColor)} />
        <span className="hidden sm:inline">BigQuery</span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 z-50 w-96 rounded-lg border bg-card shadow-lg">
          {content}
        </div>
      )}
    </div>
  );
}
