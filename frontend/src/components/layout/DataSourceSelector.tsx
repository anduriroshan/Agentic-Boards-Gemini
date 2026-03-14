import { useAgentStore } from "@/stores/agentStore";
import DatabricksSettings from "@/components/databricks/DatabricksSettings";
import BigQuerySettings from "@/components/bigquery/BigQuerySettings";
import { cn } from "@/lib/utils";

export default function DataSourceSelector() {
  const { activeConnection, setActiveConnection } = useAgentStore();

  return (
    <div className="flex flex-col w-full max-w-sm">
      {/* Tabs */}
      <div className="flex border-b border-border bg-muted/30 p-1 rounded-t-lg">
        <button
          onClick={() => setActiveConnection("databricks")}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all truncate",
            activeConnection === "databricks"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Databricks
        </button>
        <button
          onClick={() => setActiveConnection("bigquery")}
          className={cn(
            "flex-1 px-3 py-2 text-xs font-medium rounded-md transition-all truncate",
            activeConnection === "bigquery"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          BigQuery
        </button>
      </div>

      {/* Content */}
      <div className="p-0">
        {activeConnection === "databricks" ? (
          <DatabricksSettings embedded={true} />
        ) : (
          <BigQuerySettings embedded={true} />
        )}
      </div>
    </div>
  );
}
