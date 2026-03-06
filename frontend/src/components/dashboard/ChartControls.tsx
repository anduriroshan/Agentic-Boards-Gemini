import { useState, useEffect } from "react";
import type { QueryParam } from "@/types/dashboard";

interface ChartControlsProps {
  params: Record<string, QueryParam>;
  autoRefreshMs: number;
  onAutoRefreshChange: (ms: number) => void;
  onApply: (overrides: Record<string, unknown>) => void;
  isRefreshing: boolean;
}

export default function ChartControls({
  params,
  autoRefreshMs,
  onAutoRefreshChange,
  onApply,
  isRefreshing,
}: ChartControlsProps) {
  const [localValues, setLocalValues] = useState<Record<string, unknown>>(
    () => {
      const initial: Record<string, unknown> = {};
      for (const [key, param] of Object.entries(params)) {
        initial[key] = param.value;
      }
      return initial;
    },
  );

  // Sync when params change externally (e.g. after refresh returns new params)
  useEffect(() => {
    setLocalValues((prev) => {
      const next: Record<string, unknown> = {};
      for (const [key, param] of Object.entries(params)) {
        next[key] = prev[key] ?? param.value;
      }
      return next;
    });
  }, [params]);

  return (
    <div className="px-4 py-2 border-b bg-muted/30 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        {Object.entries(params).map(([key, param]) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground font-medium">
              {param.label}
            </label>
            {param.type === "number" ? (
              <input
                type="number"
                value={localValues[key] as number}
                min={param.min}
                max={param.max}
                className="w-24 px-2 py-1 border rounded text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                onChange={(e) =>
                  setLocalValues((prev) => ({
                    ...prev,
                    [key]: Number(e.target.value),
                  }))
                }
              />
            ) : param.type === "select" ? (
              <select
                value={localValues[key] as string}
                className="px-2 py-1 border rounded text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                onChange={(e) =>
                  setLocalValues((prev) => ({
                    ...prev,
                    [key]: e.target.value,
                  }))
                }
              >
                {param.options?.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            ) : null}
          </div>
        ))}

        {/* Auto-refresh selector */}
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">
            Auto-refresh
          </label>
          <select
            value={autoRefreshMs}
            className="px-2 py-1 border rounded text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
            onChange={(e) => onAutoRefreshChange(Number(e.target.value))}
          >
            <option value="0">Off</option>
            <option value="30000">30s</option>
            <option value="60000">1 min</option>
            <option value="300000">5 min</option>
          </select>
        </div>

        {/* Apply button */}
        <button
          onClick={() => onApply(localValues)}
          disabled={isRefreshing}
          className="px-3 py-1 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {isRefreshing ? "Refreshing…" : "Apply"}
        </button>
      </div>
    </div>
  );
}
