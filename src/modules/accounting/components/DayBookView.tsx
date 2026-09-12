import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatPaise } from "../constants";
import type { Voucher, VoucherType } from "../types";
import { formatDate } from "@/lib/format";
import { Download, Printer, RotateCcw, Eye, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

interface DayBookViewProps {
  vouchers: Voucher[];
  onReverse: (voucherId: string, reason: string) => Promise<{ success: boolean; error?: string }>;
}

export function DayBookView({ vouchers, onReverse }: DayBookViewProps) {
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Inspect Modal
  const [inspectVoucher, setInspectVoucher] = useState<Voucher | null>(null);

  // Reversal Modal
  const [reversingVoucher, setReversingVoucher] = useState<Voucher | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const [isReversing, setIsReversing] = useState(false);

  // Filter vouchers
  const filtered = useMemo(() => {
    return vouchers.filter((v) => {
      if (selectedType !== "all" && v.voucherType !== selectedType) return false;
      if (fromDate) {
        const fromMs = new Date(fromDate).getTime();
        if (v.date < fromMs) return false;
      }
      if (toDate) {
        const toMs = new Date(toDate).getTime() + 86400000;
        if (v.date > toMs) return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchNum = v.voucherNumber.toLowerCase().includes(q);
        const matchNarr = v.narration.toLowerCase().includes(q);
        const matchRef = (v.reference || "").toLowerCase().includes(q);
        if (!matchNum && !matchNarr && !matchRef) return false;
      }
      return true;
    });
  }, [vouchers, selectedType, fromDate, toDate, searchQuery]);

  // Aggregate totals
  const { totalDrPaise, totalCrPaise, postedCount } = useMemo(() => {
    let dr = 0;
    let cr = 0;
    let count = 0;
    for (const v of filtered) {
      if (v.status === "posted") {
        dr += v.totalDebit;
        cr += v.totalCredit;
        count++;
      }
    }
    return { totalDrPaise: dr, totalCrPaise: cr, postedCount: count };
  }, [filtered]);

  const handleConfirmReverse = async () => {
    if (!reversingVoucher) return;
    if (!reversalReason.trim()) {
      toast.error("Please provide a reason for reversing this voucher.");
      return;
    }
    setIsReversing(true);
    try {
      const res = await onReverse(reversingVoucher.id, reversalReason.trim());
      if (res.success) {
        toast.success(`Voucher ${reversingVoucher.voucherNumber} reversed successfully.`);
        setReversingVoucher(null);
        setReversalReason("");
      } else {
        toast.error(res.error || "Failed to reverse voucher.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error reversing voucher";
      toast.error(msg);
    } finally {
      setIsReversing(false);
    }
  };

  const typeBadges: Record<VoucherType, { label: string; color: string }> = {
    journal: { label: "Journal", color: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20" },
    payment: { label: "Payment", color: "bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/20" },
    receipt: { label: "Receipt", color: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/20" },
    contra: { label: "Contra", color: "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/20" },
  };

  return (
    <div className="space-y-4">
      {/* Filter Bar */}
      <Card className="p-4 card-soft flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 flex-1 min-w-[180px]">
          <Label className="text-xs">Search</Label>
          <Input
            placeholder="Search #, narration, ref..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-9"
          />
        </div>

        <div className="space-y-1.5 w-[140px]">
          <Label className="text-xs">Voucher Type</Label>
          <Select value={selectedType} onValueChange={setSelectedType}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="journal">Journal (JV)</SelectItem>
              <SelectItem value="payment">Payment (PAY)</SelectItem>
              <SelectItem value="receipt">Receipt (REC)</SelectItem>
              <SelectItem value="contra">Contra (CON)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5 w-[130px]">
          <Label className="text-xs">From Date</Label>
          <Input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        <div className="space-y-1.5 w-[130px]">
          <Label className="text-xs">To Date</Label>
          <Input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 text-xs"
          />
        </div>

        {(fromDate || toDate || searchQuery || selectedType !== "all") && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFromDate("");
              setToDate("");
              setSelectedType("all");
              setSearchQuery("");
            }}
            className="h-9 text-xs"
          >
            Clear
          </Button>
        )}

        <div className="flex items-center gap-2 ml-auto">
          <Button variant="outline" size="sm" className="h-9 gap-1.5 text-xs" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </Card>

      {/* Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-3 card-soft">
          <div className="text-[11px] font-medium text-muted-foreground uppercase">Posted Vouchers</div>
          <div className="text-xl font-bold mt-1">{postedCount}</div>
        </Card>
        <Card className="p-3 card-soft">
          <div className="text-[11px] font-medium text-muted-foreground uppercase">Day Book Total Debit</div>
          <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
            {formatPaise(totalDrPaise)}
          </div>
        </Card>
        <Card className="p-3 card-soft">
          <div className="text-[11px] font-medium text-muted-foreground uppercase">Day Book Total Credit</div>
          <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400 mt-1">
            {formatPaise(totalCrPaise)}
          </div>
        </Card>
      </div>

      {/* Transactions Table */}
      <Card className="card-soft overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/40">
            <TableRow>
              <TableHead className="w-[100px]">Date</TableHead>
              <TableHead className="w-[140px]">Voucher #</TableHead>
              <TableHead className="w-[90px]">Type</TableHead>
              <TableHead className="w-[100px]">Reference</TableHead>
              <TableHead>Narration</TableHead>
              <TableHead className="text-right w-[120px]">Debit (₹)</TableHead>
              <TableHead className="text-right w-[120px]">Credit (₹)</TableHead>
              <TableHead className="w-[90px] text-center">Status</TableHead>
              <TableHead className="w-[80px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                  No vouchers found for selected period or filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((v) => {
                const b = typeBadges[v.voucherType] || { label: v.voucherType, color: "" };
                return (
                  <TableRow key={v.id} className="hover:bg-muted/30">
                    <TableCell className="text-xs whitespace-nowrap">{formatDate(v.date)}</TableCell>
                    <TableCell className="font-mono text-xs font-semibold">{v.voucherNumber}</TableCell>
                    <TableCell>
                      <span className={`text-[11px] px-2 py-0.5 rounded border font-medium ${b.color}`}>
                        {b.label}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{v.reference || "—"}</TableCell>
                    <TableCell className="text-xs max-w-xs truncate" title={v.narration}>
                      {v.narration}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatPaise(v.totalDebit)}</TableCell>
                    <TableCell className="text-right font-mono text-xs">{formatPaise(v.totalCredit)}</TableCell>
                    <TableCell className="text-center">
                      {v.status === "posted" ? (
                        <Badge variant="outline" className="text-[10px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                          Posted
                        </Badge>
                      ) : v.status === "reversed" ? (
                        <Badge variant="outline" className="text-[10px] bg-rose-500/10 text-rose-600 border-rose-500/20">
                          Reversed
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px]">
                          {v.status}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground"
                          title="View Lines"
                          onClick={() => setInspectVoucher(v)}
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {v.status === "posted" && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            title="Reverse Voucher"
                            onClick={() => setReversingVoucher(v)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>

        {/* Day Book Balance Check Footer */}
        <div className="p-3 border-t bg-muted/20 flex flex-wrap items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            <span>Day Book Invariant: Total Debit === Total Credit ({formatPaise(totalDrPaise)})</span>
          </div>
          <div className="flex items-center gap-6 font-mono font-semibold">
            <span>Total Dr: {formatPaise(totalDrPaise)}</span>
            <span>Total Cr: {formatPaise(totalCrPaise)}</span>
          </div>
        </div>
      </Card>

      {/* Inspect Lines Modal */}
      {inspectVoucher && (
        <Dialog open={Boolean(inspectVoucher)} onOpenChange={() => setInspectVoucher(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center justify-between">
                <span>Voucher Detail: {inspectVoucher.voucherNumber}</span>
                <Badge variant="outline">{inspectVoucher.voucherType.toUpperCase()}</Badge>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-2 p-3 bg-muted/30 rounded-md">
                <div><b>Date:</b> {formatDate(inspectVoucher.date)}</div>
                <div><b>Reference:</b> {inspectVoucher.reference || "None"}</div>
                <div className="col-span-2"><b>Narration:</b> {inspectVoucher.narration}</div>
                {inspectVoucher.reversedVoucherId && (
                  <div className="col-span-2 text-rose-600 font-mono">
                    Reversal of original voucher: {inspectVoucher.reversedVoucherId}
                  </div>
                )}
                {inspectVoucher.reversalVoucherId && (
                  <div className="col-span-2 text-rose-600 font-mono">
                    Reversed by counter-voucher: {inspectVoucher.reversalVoucherId}
                  </div>
                )}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account / Ledger</TableHead>
                    <TableHead className="text-right">Debit (₹)</TableHead>
                    <TableHead className="text-right">Credit (₹)</TableHead>
                    <TableHead>Note</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inspectVoucher.lines.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="font-medium">{l.ledgerName || l.ledgerId}</TableCell>
                      <TableCell className="text-right font-mono">{l.debit > 0 ? formatPaise(l.debit) : "—"}</TableCell>
                      <TableCell className="text-right font-mono">{l.credit > 0 ? formatPaise(l.credit) : "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{l.description || "—"}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-bold border-t bg-muted/30">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right font-mono">{formatPaise(inspectVoucher.totalDebit)}</TableCell>
                    <TableCell className="text-right font-mono">{formatPaise(inspectVoucher.totalCredit)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Reversal Confirmation Modal */}
      {reversingVoucher && (
        <Dialog open={Boolean(reversingVoucher)} onOpenChange={() => setReversingVoucher(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-rose-600">
                <RotateCcw className="h-5 w-5" />
                <span>Reverse Voucher {reversingVoucher.voucherNumber}</span>
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 text-xs">
              <p className="text-muted-foreground">
                In accordance with double-entry accounting rules, financial history is <b>never deleted</b>. 
                Reversing this voucher will post an exact opposite counter-entry, restore ledger balances, 
                and mark this voucher as <b>reversed</b>.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Reason for Reversal *</Label>
                <Input
                  placeholder="e.g. Cheque cancelled, wrong account selected, duplicate entry..."
                  value={reversalReason}
                  onChange={(e) => setReversalReason(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter className="mt-4">
              <Button variant="ghost" onClick={() => setReversingVoucher(null)} disabled={isReversing}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleConfirmReverse}
                disabled={isReversing || !reversalReason.trim()}
              >
                {isReversing ? "Reversing..." : "Confirm Reversal"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
