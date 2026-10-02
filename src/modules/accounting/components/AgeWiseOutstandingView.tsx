import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, Clock, Users, Truck, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { db, type Customer, type Supplier, type Invoice, type Purchase } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";

interface AgingBill {
  id: string;
  docNumber: string;
  date: number;
  dueDate: number;
  total: number;
  balance: number;
  overdueDays: number;
  bucket: "current" | "1_30" | "31_60" | "61_90" | "91_120" | "gt_120";
}

interface PartyAgingRow {
  partyId: string;
  name: string;
  phone?: string;
  gstin?: string;
  totalOutstanding: number;
  current: number;
  bucket1_30: number;
  bucket31_60: number;
  bucket61_90: number;
  bucket91_120: number;
  bucketGt120: number;
  bills: AgingBill[];
}

export function AgeWiseOutstandingView() {
  const [viewType, setViewType] = useState<"receivables" | "payables">("receivables");
  const [search, setSearch] = useState("");
  const [selectedParty, setSelectedParty] = useState<PartyAgingRow | null>(null);
  const [isDrilldownOpen, setIsDrilldownOpen] = useState(false);

  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.toArray());
  const purchases = useLive<Purchase>(() => db().purchases.toArray());

  const now = Date.now();

  // Compute aging breakdown for each party
  const agingRows: PartyAgingRow[] = useMemo(() => {
    const list: PartyAgingRow[] = [];

    if (viewType === "receivables") {
      for (const c of customers) {
        const custInvoices = invoices.filter(
          (inv) => inv.customerId === c.id && inv.status !== "cancelled" && inv.status !== "draft" && (inv.balance || 0) > 0.01
        );

        if (custInvoices.length === 0) continue;

        let totalOutstanding = 0;
        let current = 0;
        let bucket1_30 = 0;
        let bucket31_60 = 0;
        let bucket61_90 = 0;
        let bucket91_120 = 0;
        let bucketGt120 = 0;

        const bills: AgingBill[] = [];

        for (const inv of custInvoices) {
          const bal = inv.balance || 0;
          totalOutstanding += bal;

          const due = inv.dueDate || (inv.date + (c.creditDays || 30) * 86400000);
          const overdueDays = Math.floor((now - due) / 86400000);

          let b: "current" | "1_30" | "31_60" | "61_90" | "91_120" | "gt_120" = "current";
          if (overdueDays <= 0) {
            current += bal;
            b = "current";
          } else if (overdueDays <= 30) {
            bucket1_30 += bal;
            b = "1_30";
          } else if (overdueDays <= 60) {
            bucket31_60 += bal;
            b = "31_60";
          } else if (overdueDays <= 90) {
            bucket61_90 += bal;
            b = "61_90";
          } else if (overdueDays <= 120) {
            bucket91_120 += bal;
            b = "91_120";
          } else {
            bucketGt120 += bal;
            b = "gt_120";
          }

          bills.push({
            id: inv.id,
            docNumber: inv.number,
            date: inv.date,
            dueDate: due,
            total: inv.grandTotal,
            balance: bal,
            overdueDays: Math.max(0, overdueDays),
            bucket: b,
          });
        }

        bills.sort((a, b) => b.overdueDays - a.overdueDays);

        list.push({
          partyId: c.id,
          name: c.name,
          phone: c.phone,
          gstin: c.gstin,
          totalOutstanding,
          current,
          bucket1_30,
          bucket31_60,
          bucket61_90,
          bucket91_120,
          bucketGt120,
          bills,
        });
      }
    } else {
      // Payables (Suppliers)
      for (const s of suppliers) {
        const suppPurchases = purchases.filter(
          (p) => p.supplierId === s.id && p.status !== "cancelled" && (p.balance || 0) > 0.01
        );

        if (suppPurchases.length === 0) continue;

        let totalOutstanding = 0;
        let current = 0;
        let bucket1_30 = 0;
        let bucket31_60 = 0;
        let bucket61_90 = 0;
        let bucket91_120 = 0;
        let bucketGt120 = 0;

        const bills: AgingBill[] = [];

        for (const p of suppPurchases) {
          const bal = p.balance || 0;
          totalOutstanding += bal;

          const due = (p as any).dueDate || (p.date + 30 * 86400000);
          const overdueDays = Math.floor((now - due) / 86400000);

          let b: "current" | "1_30" | "31_60" | "61_90" | "91_120" | "gt_120" = "current";
          if (overdueDays <= 0) {
            current += bal;
            b = "current";
          } else if (overdueDays <= 30) {
            bucket1_30 += bal;
            b = "1_30";
          } else if (overdueDays <= 60) {
            bucket31_60 += bal;
            b = "31_60";
          } else if (overdueDays <= 90) {
            bucket61_90 += bal;
            b = "61_90";
          } else if (overdueDays <= 120) {
            bucket91_120 += bal;
            b = "91_120";
          } else {
            bucketGt120 += bal;
            b = "gt_120";
          }

          bills.push({
            id: p.id,
            docNumber: p.number,
            date: p.date,
            dueDate: due,
            total: p.grandTotal,
            balance: bal,
            overdueDays: Math.max(0, overdueDays),
            bucket: b,
          });
        }

        bills.sort((a, b) => b.overdueDays - a.overdueDays);

        list.push({
          partyId: s.id,
          name: s.name,
          phone: s.phone,
          gstin: s.gstin,
          totalOutstanding,
          current,
          bucket1_30,
          bucket31_60,
          bucket61_90,
          bucket91_120,
          bucketGt120,
          bills,
        });
      }
    }

    list.sort((a, b) => b.totalOutstanding - a.totalOutstanding);
    return list;
  }, [viewType, customers, suppliers, invoices, purchases, now]);

  const filteredRows = useMemo(() => {
    return agingRows.filter((r) => {
      const q = search.toLowerCase();
      return (
        !search ||
        r.name.toLowerCase().includes(q) ||
        (r.phone && r.phone.includes(q)) ||
        (r.gstin && r.gstin.toLowerCase().includes(q))
      );
    });
  }, [agingRows, search]);

  // Aggregate Metrics for all buckets
  const totals = useMemo(() => {
    let grand = 0;
    let current = 0;
    let b1_30 = 0;
    let b31_60 = 0;
    let b61_90 = 0;
    let b91_120 = 0;
    let bGt120 = 0;

    for (const r of filteredRows) {
      grand += r.totalOutstanding;
      current += r.current;
      b1_30 += r.bucket1_30;
      b31_60 += r.bucket31_60;
      b61_90 += r.bucket61_90;
      b91_120 += r.bucket91_120;
      bGt120 += r.bucketGt120;
    }

    return { grand, current, b1_30, b31_60, b61_90, b91_120, bGt120 };
  }, [filteredRows]);

  // Excel Export
  const handleExportExcel = () => {
    try {
      const exportData = filteredRows.map((r, idx) => ({
        "S.No": idx + 1,
        "Party Name": r.name,
        "Phone": r.phone || "-",
        "GSTIN": r.gstin || "-",
        "Total Outstanding (INR)": Math.round(r.totalOutstanding * 100) / 100,
        "Current / Not Due": Math.round(r.current * 100) / 100,
        "1 - 30 Days": Math.round(r.bucket1_30 * 100) / 100,
        "31 - 60 Days": Math.round(r.bucket31_60 * 100) / 100,
        "61 - 90 Days": Math.round(r.bucket61_90 * 100) / 100,
        "91 - 120 Days": Math.round(r.bucket91_120 * 100) / 100,
        "> 120 Days (Critical)": Math.round(r.bucketGt120 * 100) / 100,
      }));

      // Total Row
      exportData.push({
        "S.No": "TOTAL" as unknown as number,
        "Party Name": `Parties: ${filteredRows.length}`,
        "Phone": "",
        "GSTIN": "",
        "Total Outstanding (INR)": Math.round(totals.grand * 100) / 100,
        "Current / Not Due": Math.round(totals.current * 100) / 100,
        "1 - 30 Days": Math.round(totals.b1_30 * 100) / 100,
        "31 - 60 Days": Math.round(totals.b31_60 * 100) / 100,
        "61 - 90 Days": Math.round(totals.b61_90 * 100) / 100,
        "91 - 120 Days": Math.round(totals.b91_120 * 100) / 100,
        "> 120 Days (Critical)": Math.round(totals.bGt120 * 100) / 100,
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Age-Wise Outstanding");
      XLSX.writeFile(
        wb,
        `Age_Wise_Outstanding_${viewType}_${new Date().toISOString().slice(0, 10)}.xlsx`
      );
      toast.success("Age-wise outstanding report exported to Excel");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to export Excel");
    }
  };

  const handleRowClick = (r: PartyAgingRow) => {
    setSelectedParty(r);
    setIsDrilldownOpen(true);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards across Aging Buckets */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">Current / Not Due</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {formatMoney(totals.current)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Within credit terms</div>
        </Card>

        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">1 - 30 Days</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {formatMoney(totals.b1_30)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Recent overdue</div>
        </Card>

        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">31 - 60 Days</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {formatMoney(totals.b31_60)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Attention needed</div>
        </Card>

        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">61 - 90 Days</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-orange-600 dark:text-orange-400">
            {formatMoney(totals.b61_90)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Notice required</div>
        </Card>

        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">91 - 120 Days</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-rose-500">
            {formatMoney(totals.b91_120)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">High aging risk</div>
        </Card>

        <Card className="p-3 border-border/60 bg-card/60 shadow-2xs">
          <div className="text-[11px] text-muted-foreground font-medium">&gt; 120 Days (Critical)</div>
          <div className="mt-1 text-lg font-bold tracking-tight text-rose-700 dark:text-rose-400">
            {formatMoney(totals.bGt120)}
          </div>
          <div className="text-[10px] text-muted-foreground mt-0.5">Critical recovery</div>
        </Card>
      </div>

      {/* Filter and View Toggle */}
      <Card className="p-3 border-border/60 bg-card/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <div className="flex rounded-md bg-secondary/50 p-0.5 border border-border/60">
              <Button
                variant={viewType === "receivables" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setViewType("receivables")}
              >
                <Users className="h-3.5 w-3.5" />
                <span>Customer Receivables</span>
              </Button>
              <Button
                variant={viewType === "payables" ? "default" : "ghost"}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => setViewType("payables")}
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Vendor Payables</span>
              </Button>
            </div>

            <div className="relative min-w-[220px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search party name, phone, GSTIN..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
          </div>

          <Button onClick={handleExportExcel} variant="outline" size="sm" className="gap-1.5 h-9 text-xs">
            <Download className="h-3.5 w-3.5 text-emerald-600" />
            <span>Export to Excel</span>
          </Button>
        </div>
      </Card>

      {/* Aging Table */}
      <Card className="border-border/60 overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-secondary/40">
              <TableRow className="text-xs">
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Party Name</TableHead>
                <TableHead className="text-right font-bold text-foreground">Total Due</TableHead>
                <TableHead className="text-right text-emerald-600 dark:text-emerald-400">Current</TableHead>
                <TableHead className="text-right text-blue-600 dark:text-blue-400">1 - 30d</TableHead>
                <TableHead className="text-right text-amber-600 dark:text-amber-400">31 - 60d</TableHead>
                <TableHead className="text-right text-orange-600 dark:text-orange-400">61 - 90d</TableHead>
                <TableHead className="text-right text-rose-500">91 - 120d</TableHead>
                <TableHead className="text-right text-rose-700 dark:text-rose-400 font-bold">&gt; 120d</TableHead>
                <TableHead className="w-12 text-center"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="text-xs divide-y divide-border/40">
              {filteredRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-12 text-center text-muted-foreground">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500/70 mb-2" />
                    <p className="font-medium text-sm">No Outstanding Debts</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      All accounts in this category are completely cleared.
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                filteredRows.map((r, idx) => (
                  <TableRow
                    key={r.partyId}
                    className="hover:bg-secondary/30 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(r)}
                  >
                    <TableCell className="text-center text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell>
                      <div className="font-semibold text-foreground">{r.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {r.bills.length} unpaid bill{r.bills.length > 1 ? "s" : ""}
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold text-foreground">
                      {formatMoney(r.totalOutstanding)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.current ? formatMoney(r.current) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.bucket1_30 ? formatMoney(r.bucket1_30) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.bucket31_60 ? formatMoney(r.bucket31_60) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {r.bucket61_90 ? formatMoney(r.bucket61_90) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-rose-500 font-medium">
                      {r.bucket91_120 ? formatMoney(r.bucket91_120) : "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-rose-700 dark:text-rose-400 font-bold">
                      {r.bucketGt120 ? formatMoney(r.bucketGt120) : "-"}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      <ChevronRight className="h-4 w-4" />
                    </TableCell>
                  </TableRow>
                ))
              )}

              {/* Total Row */}
              {filteredRows.length > 0 && (
                <TableRow className="bg-secondary/25 font-bold border-t-2 border-border/80">
                  <TableCell className="text-center font-mono">-</TableCell>
                  <TableCell className="text-foreground">TOTAL SUMMARY</TableCell>
                  <TableCell className="text-right font-mono font-bold text-foreground">
                    {formatMoney(totals.grand)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                    {formatMoney(totals.current)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-blue-600 dark:text-blue-400">
                    {formatMoney(totals.b1_30)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-amber-600 dark:text-amber-400">
                    {formatMoney(totals.b31_60)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-orange-600 dark:text-orange-400">
                    {formatMoney(totals.b61_90)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-rose-500 font-bold">
                    {formatMoney(totals.b91_120)}
                  </TableCell>
                  <TableCell className="text-right font-mono text-rose-700 dark:text-rose-400 font-bold">
                    {formatMoney(totals.bGt120)}
                  </TableCell>
                  <TableCell></TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Bill-by-bill Drilldown Dialog */}
      <Dialog open={isDrilldownOpen} onOpenChange={setIsDrilldownOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between text-base">
              <span>Aging Breakdown: {selectedParty?.name}</span>
              <Badge variant="outline" className="text-xs font-bold">
                Total: {formatMoney(selectedParty?.totalOutstanding || 0)}
              </Badge>
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto py-2 text-xs">
            <Table>
              <TableHeader className="bg-secondary/40">
                <TableRow className="text-xs">
                  <TableHead>Bill / Doc #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due Date</TableHead>
                  <TableHead className="text-right">Bill Total</TableHead>
                  <TableHead className="text-right font-bold">Balance Due</TableHead>
                  <TableHead className="text-center">Overdue Days</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs divide-y divide-border/40">
                {selectedParty?.bills.map((b) => (
                  <TableRow key={b.id}>
                    <TableCell className="font-semibold text-foreground font-mono">{b.docNumber}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.date)}</TableCell>
                    <TableCell className="text-muted-foreground">{formatDate(b.dueDate)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(b.total)}</TableCell>
                    <TableCell className="text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                      {formatMoney(b.balance)}
                    </TableCell>
                    <TableCell className="text-center">
                      {b.overdueDays === 0 ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                          Not Due
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            b.overdueDays > 90
                              ? "text-[10px] bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 font-bold"
                              : "text-[10px] bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                          }
                        >
                          {b.overdueDays} days overdue
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <DialogFooter className="pt-2 border-t border-border/50">
            <Button variant="outline" size="sm" onClick={() => setIsDrilldownOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
