import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, AlertCircle, CheckCircle2, ArrowRightLeft } from "lucide-react";
import { toast } from "sonner";
import { formatPaise, rupeesToPaise } from "../constants";
import type { VoucherType, Ledger } from "../types";

interface LineItemState {
  id: string;
  ledgerId: string;
  debit: string;
  credit: string;
  description: string;
}

interface VoucherEntryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: VoucherType;
  ledgers: Ledger[];
  onPost: (data: {
    voucherType: VoucherType;
    date: number;
    reference: string;
    narration: string;
    branchId?: string;
    lines: { ledgerId: string; debit: number; credit: number; description?: string }[];
    amountsInRupees: boolean;
  }) => Promise<{ success: boolean; error?: string; voucherNumber?: string; code?: string }>;
}

export function VoucherEntryModal({
  open,
  onOpenChange,
  defaultType = "journal",
  ledgers,
  onPost,
}: VoucherEntryModalProps) {
  const [voucherType, setVoucherType] = useState<VoucherType>(defaultType);
  const [dateStr, setDateStr] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reference, setReference] = useState("");
  const [narration, setNarration] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Liquidity ledgers (Cash & Bank)
  const liquidityLedgers = useMemo(() => {
    return ledgers.filter(
      (l) =>
        l.partyType === "cash" ||
        l.partyType === "bank" ||
        l.groupId === "grp_cash" ||
        l.groupId === "grp_bank" ||
        l.groupId === "grp_cash_equiv"
    );
  }, [ledgers]);

  // General active ledgers
  const activeLedgers = useMemo(() => {
    return ledgers.filter((l) => l.active !== false);
  }, [ledgers]);

  // Dynamic voucher lines
  const [lines, setLines] = useState<LineItemState[]>([
    { id: "1", ledgerId: "", debit: "", credit: "", description: "" },
    { id: "2", ledgerId: "", debit: "", credit: "", description: "" },
  ]);

  // Reset lines when opening or switching types
  useEffect(() => {
    if (open) {
      setVoucherType(defaultType);
      setDateStr(new Date().toISOString().slice(0, 10));
      setReference("");
      setNarration("");
      setLines([
        { id: "1", ledgerId: "", debit: "", credit: "", description: "" },
        { id: "2", ledgerId: "", debit: "", credit: "", description: "" },
      ]);
    }
  }, [open, defaultType]);

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now() + Math.random()),
        ledgerId: "",
        debit: "",
        credit: "",
        description: "",
      },
    ]);
  };

  const removeLine = (id: string) => {
    if (lines.length <= 2) {
      toast.error("A double-entry voucher must have at least 2 lines.");
      return;
    }
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const updateLine = (id: string, updates: Partial<LineItemState>) => {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...updates };
        // If user enters debit, clear credit
        if ("debit" in updates && updates.debit && parseFloat(updates.debit) > 0) {
          next.credit = "";
        }
        // If user enters credit, clear debit
        if ("credit" in updates && updates.credit && parseFloat(updates.credit) > 0) {
          next.debit = "";
        }
        return next;
      })
    );
  };

  // Monetary calculations in integer paise
  const { totalDebitPaise, totalCreditPaise, diffPaise, isBalanced } = useMemo(() => {
    let dPaise = 0;
    let cPaise = 0;
    for (const l of lines) {
      const d = parseFloat(l.debit) || 0;
      const c = parseFloat(l.credit) || 0;
      dPaise += rupeesToPaise(d);
      cPaise += rupeesToPaise(c);
    }
    const diff = Math.abs(dPaise - cPaise);
    return {
      totalDebitPaise: dPaise,
      totalCreditPaise: cPaise,
      diffPaise: diff,
      isBalanced: dPaise > 0 && dPaise === cPaise,
    };
  }, [lines]);

  const handleSubmit = async () => {
    if (!isBalanced) {
      toast.error(
        `Voucher is unbalanced! Total Debit (${formatPaise(
          totalDebitPaise
        )}) does not equal Total Credit (${formatPaise(totalCreditPaise)}).`
      );
      return;
    }

    if (!narration.trim()) {
      toast.error("Please enter a narration describing the transaction.");
      return;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.ledgerId) {
        toast.error(`Line ${i + 1}: Please select a ledger.`);
        return;
      }
      const d = parseFloat(line.debit) || 0;
      const c = parseFloat(line.credit) || 0;
      if (d === 0 && c === 0) {
        toast.error(`Line ${i + 1}: Amount cannot be zero.`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const res = await onPost({
        voucherType,
        date: new Date(dateStr).getTime(),
        reference: reference.trim(),
        narration: narration.trim(),
        lines: lines.map((l) => ({
          ledgerId: l.ledgerId,
          debit: parseFloat(l.debit) || 0,
          credit: parseFloat(l.credit) || 0,
          description: l.description.trim(),
        })),
        amountsInRupees: true,
      });

      if (res.success) {
        toast.success(`Voucher ${res.voucherNumber || ""} posted successfully!`);
        onOpenChange(false);
      } else {
        if (res.code === "SERVER_CONFIG_REQUIRED") {
          toast.error(
            "Posting blocked: Firebase Admin server credentials required. Operation halted safely without client mutation."
          );
        } else {
          toast.error(res.error || "Failed to post voucher.");
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error posting voucher";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const eligibleLedgers = voucherType === "contra" ? liquidityLedgers : activeLedgers;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="p-6 pb-2 border-b">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <span className="capitalize">{voucherType} Voucher Entry</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-primary/10 text-primary uppercase">
                Double Entry
              </span>
            </DialogTitle>
          </div>
        </DialogHeader>

        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Header metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Voucher Type</Label>
              <Select
                value={voucherType}
                onValueChange={(v) => setVoucherType(v as VoucherType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="journal">Journal (JV)</SelectItem>
                  <SelectItem value="payment">Payment (PAY)</SelectItem>
                  <SelectItem value="receipt">Receipt (REC)</SelectItem>
                  <SelectItem value="contra">Contra (CON)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-medium">Date</Label>
              <Input
                type="date"
                value={dateStr}
                onChange={(e) => setDateStr(e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs font-medium">Reference / Bill / Cheque #</Label>
              <Input
                placeholder="Optional external reference..."
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </div>
          </div>

          {voucherType === "contra" && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-md text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <ArrowRightLeft className="h-4 w-4 shrink-0" />
              <span>
                Contra vouchers strictly transfer funds between <b>Cash & Bank</b> accounts. Non-liquidity accounts are excluded.
              </span>
            </div>
          )}

          {/* Double-Entry Lines Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-semibold">Accounting Lines</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={addLine}
              >
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>
            </div>

            <div className="border rounded-md overflow-hidden">
              <Table>
                <TableHeader className="bg-muted/40">
                  <TableRow>
                    <TableHead className="w-[35%]">Ledger Account</TableHead>
                    <TableHead className="w-[20%] text-right">Debit (₹)</TableHead>
                    <TableHead className="w-[20%] text-right">Credit (₹)</TableHead>
                    <TableHead className="w-[20%]">Line Note</TableHead>
                    <TableHead className="w-[5%]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, idx) => (
                    <TableRow key={line.id}>
                      <TableCell className="p-2">
                        <Select
                          value={line.ledgerId}
                          onValueChange={(val) => updateLine(line.id, { ledgerId: val })}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Select account…" />
                          </SelectTrigger>
                          <SelectContent className="max-h-60">
                            {eligibleLedgers.map((led) => (
                              <SelectItem key={led.id} value={led.id} className="text-xs">
                                {led.name} ({led.groupNature.toUpperCase()})
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="p-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.debit}
                          onChange={(e) => updateLine(line.id, { debit: e.target.value })}
                          className="h-9 text-right font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell className="p-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={line.credit}
                          onChange={(e) => updateLine(line.id, { credit: e.target.value })}
                          className="h-9 text-right font-mono text-xs"
                        />
                      </TableCell>
                      <TableCell className="p-2">
                        <Input
                          placeholder="Optional note"
                          value={line.description}
                          onChange={(e) => updateLine(line.id, { description: e.target.value })}
                          className="h-9 text-xs"
                        />
                      </TableCell>
                      <TableCell className="p-2 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => removeLine(line.id)}
                          disabled={lines.length <= 2}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Double-Entry Balance Check Display */}
          <div
            className={`p-3.5 rounded-lg border flex flex-wrap items-center justify-between gap-4 transition-colors ${
              isBalanced
                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:text-emerald-300"
                : "bg-rose-500/10 border-rose-500/30 text-rose-800 dark:text-rose-300"
            }`}
          >
            <div className="flex items-center gap-2 text-xs font-semibold">
              {isBalanced ? (
                <>
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Double-Entry Balanced (Dr === Cr)</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                  <span>
                    Unbalanced Entry: Imbalance of {formatPaise(diffPaise)}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-6 text-xs font-mono font-bold">
              <div>
                <span className="text-muted-foreground text-[10px] uppercase mr-1.5">
                  Total Debit:
                </span>
                <span>{formatPaise(totalDebitPaise)}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-[10px] uppercase mr-1.5">
                  Total Credit:
                </span>
                <span>{formatPaise(totalCreditPaise)}</span>
              </div>
            </div>
          </div>

          {/* Narration */}
          <div className="space-y-1.5">
            <Label className="text-xs font-medium">
              Narration <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. Paid office rent for September 2026 via cheque #44021"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="p-4 border-t bg-muted/20 flex items-center justify-between">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isBalanced || isSubmitting || !narration.trim()}
            className="gap-2"
          >
            {isSubmitting ? "Posting..." : "Post Voucher"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
