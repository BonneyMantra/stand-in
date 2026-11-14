import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sort?: (row: T) => string | number;
  className?: string;
  /** Hide the column below a breakpoint so phones never scroll sideways. */
  hide?: "sm" | "md" | "lg";
}

// Container widths, not the viewport: from md up the sidebar takes 256px, so a 768px window has a ~460px table.
const HIDE = { sm: "hidden @xl:table-cell", md: "hidden @2xl:table-cell", lg: "hidden @3xl:table-cell" };

/** Table styling adapted from ReUI data-grid (dense rows, sticky header, sortable headers),
 *  reduced to a semantic <table>: sort buttons expose aria-sort, rows with a link are
 *  reachable with Tab and open with Enter. */
export function DataTable<T>({
  rows, columns, rowKey, rowHref, rowTone, initialSort, caption, empty, pageSize = 25,
}: {
  rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; rowHref?: (r: T) => string | undefined;
  rowTone?: (r: T) => "trip" | undefined; initialSort?: { id: string; dir: "asc" | "desc" }; caption: string; empty?: ReactNode; pageSize?: number;
}) {
  const [limit, setLimit] = useState(pageSize);
  const nav = useNavigate();
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.id === sort.id);
    if (!col?.sort) return rows;
    const f = col.sort;
    return [...rows].sort((a, b) => {
      const x = f(a), y = f(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort!.dir === "asc" ? r : -r;
    });
  }, [rows, columns, sort]);

  const toggle = (id: string) =>
    setSort((s) => (s?.id === id ? { id, dir: s.dir === "asc" ? "desc" : "asc" } : { id, dir: "desc" }));

  return (
    <div className="@container overflow-hidden rounded-[10px] border border-line bg-ink-900/60">
      <table className="w-full table-fixed border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-ink-900">
          <tr className="border-b border-line">
            {columns.map((c) => {
              const active = sort?.id === c.id;
              return (
                <th
                  key={c.id}
                  scope="col"
                  aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                  className={cn("h-9 px-3 font-normal text-fg-faint first:pl-4", c.hide && HIDE[c.hide], c.className)}
                >
                  {c.sort ? (
                    <button type="button" onClick={() => toggle(c.id)} className="-mx-1 inline-flex items-center gap-1 rounded px-1 outline-none hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
                      {c.header}
                      {active ? (sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />) : <ChevronsUpDown className="size-3 opacity-50" aria-hidden />}
                    </button>
                  ) : c.header}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sorted.slice(0, limit).map((r) => {
            const href = rowHref?.(r);
            const tone = rowTone?.(r);
            return (
              <tr
                key={rowKey(r)}
                tabIndex={href ? 0 : undefined}
                onClick={href ? (e) => { if (!(e.target as HTMLElement).closest("a,button")) nav(href); } : undefined}
                onKeyDown={href ? (e) => { if (e.key === "Enter" && e.target === e.currentTarget) nav(href); } : undefined}
                className={cn(
                  "outline-none transition-colors focus-visible:bg-ink-850 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  href && "cursor-pointer hover:bg-ink-850",
                  tone === "trip" && "bg-trip-soft/60",
                )}
              >
                {columns.map((c) => (
                  <td key={c.id} className={cn("h-11 min-w-0 truncate px-3 align-middle first:pl-4", c.hide && HIDE[c.hide], c.className)}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && empty}
      {sorted.length > limit && (
        <button type="button" onClick={() => setLimit((l) => l + pageSize)} className="w-full border-t border-line py-2.5 font-mono text-[11px] text-fg-muted outline-none hover:bg-ink-850 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
          Show {Math.min(pageSize, sorted.length - limit)} more · {sorted.length - limit} hidden
        </button>
      )}
    </div>
  );
}
