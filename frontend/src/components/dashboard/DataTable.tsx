import { useState, useMemo } from "react";
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
} from "@tanstack/react-table";

export interface DataTableColumn {
  field: string;
  headerName: string;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
}

export default function DataTable({ columns, rows }: DataTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columnDefs = useMemo<ColumnDef<Record<string, unknown>>[]>(
    () =>
      columns.map((col) => ({
        accessorKey: col.field,
        header: col.headerName,
        cell: (info) => {
          const val = info.getValue();
          if (val === null || val === undefined) return <span className="text-muted-foreground italic">null</span>;
          if (typeof val === "number") return <span className="tabular-nums">{val.toLocaleString()}</span>;
          return String(val);
        },
      })),
    [columns],
  );

  const table = useReactTable({
    data: rows,
    columns: columnDefs,
    state: { sorting, globalFilter },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 50 } },
  });

  return (
    <div className="flex flex-col h-full text-xs">
      {/* Search bar */}
      <div className="shrink-0 px-2 py-1.5 border-b bg-muted/30">
        <input
          type="text"
          placeholder="Search across all columns…"
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          className="w-full px-2 py-1 rounded border bg-background text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Scrollable table */}
      <div className="flex-1 overflow-auto min-h-0">
        <table className="w-full border-collapse">
          <thead className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((header) => (
                  <th
                    key={header.id}
                    onClick={header.column.getToggleSortingHandler()}
                    className="px-3 py-1.5 text-left font-semibold border-b border-r last:border-r-0 cursor-pointer select-none whitespace-nowrap hover:bg-muted-foreground/10"
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: " ▲",
                        desc: " ▼",
                      }[header.column.getIsSorted() as string] ?? ""}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className="hover:bg-primary/5 border-b last:border-b-0"
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-3 py-1 border-r last:border-r-0 whitespace-nowrap">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 flex items-center justify-between px-3 py-1.5 border-t bg-muted/30 text-muted-foreground">
        <span>
          {table.getFilteredRowModel().rows.length} row{table.getFilteredRowModel().rows.length !== 1 ? "s" : ""}
          {globalFilter && " (filtered)"}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="px-2 py-0.5 rounded border disabled:opacity-30 hover:bg-muted"
          >
            ← Prev
          </button>
          <span>
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="px-2 py-0.5 rounded border disabled:opacity-30 hover:bg-muted"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
