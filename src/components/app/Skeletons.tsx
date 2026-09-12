import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

function Bar({ w = "w-full", h = "h-4" }: { w?: string; h?: string }) {
  return <div className={`${h} ${w} animate-pulse rounded-md bg-muted`} />;
}

export function ListSkeleton({ columns = 5, rows = 6 }: { columns?: number; rows?: number }) {
  return (
    <div className="animate-fade-in space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Bar w="w-64" h="h-9" />
        <Bar w="w-24" h="h-9" />
      </div>
      <Card className="card-soft overflow-hidden">
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
          <Card key={i} className="card-soft p-4">
            <Bar w="w-24" h="h-3" />
            <div className="mt-3"><Bar w="w-32" h="h-6" /></div>
          </Card>
        ))}
      </div>
      <ListSkeleton />
    </div>
  );
}
