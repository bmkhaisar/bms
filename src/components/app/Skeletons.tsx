import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function Bar({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} animate-pulse rounded-md bg-muted/70`} />;
}

export function KpiCardSkeleton() {
  return (
    <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <Bar w="w-24" h="h-3" />
        <div className="h-8 w-8 rounded-xl bg-muted/60 animate-pulse" />
      </div>
      <div className="mt-3">
        <Bar w="w-32" h="h-6" />
      </div>
      <div className="mt-2">
        <Bar w="w-20" h="h-2.5" />
      </div>
    </Card>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="rounded-2xl border border-border/60 bg-card/85 p-4 lg:col-span-2 shadow-sm">
          <Bar w="w-40" h="h-4" />
          <div className="mt-4 h-64 w-full rounded-xl bg-muted/30 animate-pulse" />
        </Card>
        <Card className="rounded-2xl border border-border/60 bg-card/85 p-4 shadow-sm">
          <Bar w="w-32" h="h-4" />
          <div className="mt-4 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex justify-between items-center">
                <Bar w="w-28" h="h-3" />
                <Bar w="w-16" h="h-3" />
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

export function ListSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Bar w="w-64" h="h-9" />
        <Bar w="w-24" h="h-9" />
      </div>
      <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur overflow-hidden shadow-sm">
        <div className="overflow-x-auto scrollbar-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                {Array.from({ length: columns }).map((_, i) => (
                  <TableHead key={i}><Bar w="w-24" h="h-3" /></TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: rows }).map((_, r) => (
                <TableRow key={r}>
                  {Array.from({ length: columns }).map((_, c) => (
                    <TableCell key={c}>
                      <Bar w={c === 0 ? "w-20" : c === columns - 1 ? "w-16" : "w-32"} />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-fade-in space-y-6">
      <div className="space-y-2">
        <Bar w="w-48" h="h-6" />
        <Bar w="w-72" h="h-3" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <KpiCardSkeleton key={i} />
        ))}
      </div>
      <ListSkeleton />
    </div>
  );
}
