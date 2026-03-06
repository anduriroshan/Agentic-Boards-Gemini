import { useFilterStore } from "@/stores/filterStore";
import { FilterX, Calendar } from "lucide-react";

export default function FilterBar() {
    const { filters, setDateRange, clearFilters } = useFilterStore();
    const hasFilters = Boolean(filters.dateFrom || filters.dateTo);

    return (
        <div className="flex items-center gap-4 bg-muted/30 border-b border-border/50 px-4 py-2 shrink-0">
            <div className="flex items-center gap-2 text-sm text-foreground/80 font-medium">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span>Date Range:</span>
            </div>

            <div className="flex items-center gap-2">
                <input
                    type="date"
                    value={filters.dateFrom}
                    onChange={(e) => setDateRange(e.target.value, filters.dateTo)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <span className="text-muted-foreground text-sm">to</span>
                <input
                    type="date"
                    value={filters.dateTo}
                    onChange={(e) => setDateRange(filters.dateFrom, e.target.value)}
                    min={filters.dateFrom}
                    className="rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
            </div>

            {hasFilters && (
                <button
                    onClick={clearFilters}
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
                    title="Clear Filters"
                >
                    <FilterX className="h-3.5 w-3.5" />
                    Clear
                </button>
            )}
        </div>
    );
}
