"use client";

import {
  flexRender,
  SortingState,
  ColumnFiltersState,
  RowSelectionState,
  PaginationState,
  RowData,
} from "@tanstack/react-table";
import {
  useLegacyTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  type LegacyTableOptions,
  type LegacyColumnDef,
} from "@tanstack/react-table/legacy";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "./utils";
import { Button } from "./primitives";
import { useState, useMemo } from "react";

// ---------------------------------------------------------------- DataTable
interface DataTableProps<TData extends RowData, TValue> {
  columns: LegacyColumnDef<TData, TValue>[];
  data: TData[];
  filterPlaceholder?: string;
  pagination?: boolean;
  pageSize?: number;
  showPageSizeSelector?: boolean;
  pageSizeOptions?: number[];
  onRowClick?: (row: TData) => void;
  striped?: boolean;
  hoverable?: boolean;
  className?: string;
}

export function DataTable<TData extends RowData, TValue>({
  columns,
  data,
  filterPlaceholder = "Filter...",
  pagination = true,
  pageSize = 10,
  showPageSizeSelector = false,
  pageSizeOptions = [10, 20, 30, 50, 100],
  onRowClick,
  striped = false,
  hoverable = true,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [pageIndex, setPageIndex] = useState(0);
  const [currentPageSize, setCurrentPageSize] = useState(pageSize);

  const table = useLegacyTable({
    data: data as any[],
    columns: columns as any[],
    state: {
      sorting,
      columnFilters,
      globalFilter,
      rowSelection,
      pagination: { pageIndex, pageSize: currentPageSize }
    } as any,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onPaginationChange: setPageIndex as any,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  } as LegacyTableOptions<TData>);

  return (
    <div className={cn("space-y-4", className)}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1">
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder={filterPlaceholder}
            className="w-full h-10 rounded-lg border border-line bg-panel px-3 pl-10 text-sm placeholder:text-muted"
          />
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {showPageSizeSelector && (
            <select
              value={currentPageSize}
              onChange={(e) => { setCurrentPageSize(Number(e.target.value)); setPageIndex(0); }}
              className="h-10 rounded-lg border border-line bg-panel px-3 text-sm"
            >
              {pageSizeOptions.map((size) => <option key={size} value={size}>{size} rows</option>)}
            </select>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="relative overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm" role="grid">
          <thead className="bg-surface">
            {table.getHeaderGroups().map((headerGroup: any) => (
              <tr key={headerGroup.id} className="border-b border-line">
                {headerGroup.headers.map((header: any) => (
                  <th
                    key={header.id}
                    scope="col"
                    className={cn(
                      "px-4 py-3 font-medium text-left text-muted uppercase tracking-wider",
                      header.column.getCanSort() && "cursor-pointer hover:text-ink select-none",
                    )}
                    style={{ width: header.column.getSize() }}
                    onClick={header.column.getToggleSortingHandler()}
                  >
                    <div className="flex items-center gap-2">
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {{
                        asc: <ChevronUp className="h-4 w-4" />,
                        desc: <ChevronDown className="h-4 w-4" />,
                      }[header.column.getIsSorted() as string] ?? (
                        header.column.getCanSort() && <ChevronsUpDown className="h-4 w-4 text-muted" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center text-muted">No data found</td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row: any, i: number) => (
                <tr
                  key={row.id}
                  className={cn(
                    "border-b border-line last:border-0 transition-colors",
                    striped && i % 2 === 0 && "bg-surface/50",
                    hoverable && "hover:bg-surface/50",
                    onRowClick && "cursor-pointer",
                  )}
                  onClick={() => onRowClick?.(row.original)}
                >
                  {row.getVisibleCells().map((cell: any) => (
                    <td
                      key={cell.id}
                      className="px-4 py-3 align-top"
                      style={{ width: cell.column.getSize() }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-2 py-2">
          <div className="text-sm text-muted">
            Page <strong>{table.getPageCount() > 0 ? table.getState().pagination.pageIndex + 1 : 0}</strong> of <strong>{table.getPageCount()}</strong> |{" "}
            <strong>{table.getFilteredRowModel().rows.length}</strong> rows
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Previous page"
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Next page"
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}