import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
import { ReactNode, useState } from "react";
import { Card } from "@/components/ui/card";

export function ListToolbar({
  query, onQuery, placeholder = "Search…", right,
}: { query: string; onQuery: (v: string) => void; placeholder?: string; right?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px] max-w-md">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} className="pl-8" />
      </div>
      <div className="ml-auto flex gap-2">{right}</div>
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <Card className="card-soft flex flex-col items-center gap-2 py-12 text-center">
      <div className="text-base font-semibold">{title}</div>
      {description && <div className="max-w-md text-sm text-muted-foreground">{description}</div>}
      {action}
    </Card>
  );
}

export function usePagination<T>(rows: T[], pageSize = 10) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const p = Math.min(page, totalPages);
  const items = rows.slice((p - 1) * pageSize, p * pageSize);
  return {
    items, page: p, totalPages,
    next: () => setPage(x => Math.min(totalPages, x + 1)),
    prev: () => setPage(x => Math.max(1, x - 1)),
    setPage,
  };
}

export function Pager({ page, totalPages, next, prev }: { page: number; totalPages: number; next: () => void; prev: () => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-sm">
      <Button variant="outline" size="sm" onClick={prev} disabled={page === 1}>Previous</Button>
      <span className="text-muted-foreground">Page {page} of {totalPages}</span>
      <Button variant="outline" size="sm" onClick={next} disabled={page === totalPages}>Next</Button>
    </div>
  );
}
