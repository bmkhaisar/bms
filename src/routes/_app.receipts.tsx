import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import {
  db,
  uid,
  nextNumber,
  type Receipt,
  type Payment,
  type Customer,
  type Supplier,
  type Invoice,
  type Purchase,
  type CompanySettings,
  getCompany,
} from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/app/ConfirmDialog";
import { toast } from "sonner";
import { formatMoney, formatDate, toDateInput, fromDateInput } from "@/lib/format";
import { HandCoins, ArrowDownLeft, ArrowUpRight, Plus, Trash2, BookOpen } from "lucide-react";
import { ListToolbar, usePagination, Pager, EmptyState } from "@/components/app/ListHelpers";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { postReceiptTransaction, postPaymentTransaction } from "@/modules/accounting/services/documentPostingService";

export const Route = createFileRoute("/_app/receipts")({
  head: () => ({ meta: [{ title: "Receipts & Payments — BMS NEXT" }] }),
  component: ReceiptsAndPaymentsPage,
});

export function ReceiptsAndPaymentsPage() {
  const { user } = useAuth();
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const [activeTab, setActiveTab] = useState<"receipts" | "payments">("receipts");

  // Receipts data
  const receipts = useLive<Receipt>(() => db().receipts.orderBy("createdAt").reverse().toArray());
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.orderBy("createdAt").reverse().toArray());

  // Payments data
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());

  // Accounting Ledgers for real settlement
  const { ledgers } = useAccounting();
  const cashLedgers = ledgers.filter((l) => l.groupId === "grp_cash" && l.active !== false);
  const bankLedgers = ledgers.filter((l) => l.groupId === "grp_bank_accounts" && l.active !== false);

  const [q, setQ] = useState("");
  const [openReceipt, setOpenReceipt] = useState(false);
  const [openPayment, setOpenPayment] = useState(false);

  const [editingReceipt, setEditingReceipt] = useState<Receipt | null>(null);
  const [editingPayment, setEditingPayment] = useState<Payment | null>(null);
  const [deleteReceiptId, setDeleteReceiptId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredReceipts = receipts.filter(
    (r) =>
      !q ||
      r.number.toLowerCase().includes(q.toLowerCase()) ||
      (customers.find((c) => c.id === r.customerId)?.name.toLowerCase().includes(q.toLowerCase()) ?? false)
  );
  const receiptsPager = usePagination(filteredReceipts, 12);

  async function openNewReceipt() {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const number = await getNextDocumentNumber({
      kind: "receipt",
      companyId: activeCompany?.id,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      idToken,
      customPrefix: activeCompany?.receiptPrefix,
    });
    const defaultCash = cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_cash`;
    setEditingReceipt({
      id: uid(),
      number,
      date: Date.now(),
      customerId: "",
      amount: 0,
      mode: "cash",
      paymentMethod: "cash",
      settlementLedgerId: defaultCash,
      createdAt: Date.now(),
    });
    setOpenReceipt(true);
  }

  async function openNewPayment() {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const number = await getNextDocumentNumber({
      kind: "purchase",
      companyId: activeCompany?.id,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      idToken,
      customPrefix: "PAY",
    });
    const defaultBank = bankLedgers[0]?.id || cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_bank`;
    setEditingPayment({
      id: uid(),
      number,
      date: Date.now(),
      supplierId: "",
      amount: 0,
      mode: "bank",
      paymentMethod: "bank_transfer",
      settlementLedgerId: defaultBank,
      createdAt: Date.now(),
    });
    setOpenPayment(true);
  }

  async function saveReceipt() {
    if (!editingReceipt) return;
    if (!editingReceipt.customerId) {
      toast.error("Please select a customer");
      return;
    }
    if (editingReceipt.amount <= 0) {
      toast.error("Receipt amount must be greater than zero");
      return;
    }

    setSaving(true);
    try {
      if (activeCompany?.id && activeFinancialYear?.id && user) {
        const idToken = await user.getIdToken();
        const customer = customers.find((c) => c.id === editingReceipt.customerId);
        const customerLedgerId = customer?.ledgerId || `led_${activeCompany.id}_cust_${editingReceipt.customerId}`;

        await postReceiptTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          receipt: editingReceipt,
          customerLedgerId,
          settlementLedgerId: editingReceipt.settlementLedgerId,
          idToken,
          uid: user.uid,
        });
      } else {
        await db().receipts.put(editingReceipt);
      }

      // Update linked invoice balance if applicable
      if (editingReceipt.invoiceId) {
        const inv = await db().invoices.get(editingReceipt.invoiceId);
        if (inv) {
          const paid = inv.amountPaid + editingReceipt.amount;
          const balance = Math.max(0, inv.grandTotal - paid);
          inv.amountPaid = paid;
          inv.balance = balance;
          inv.status = balance <= 0.01 ? "paid" : "partial";
          await db().invoices.put(inv);
        }
      }

      toast.success("Receipt posted & ledger updated");
      setOpenReceipt(false);
      setEditingReceipt(null);
    } catch (err) {
      console.error("Failed to post receipt:", err);
      toast.error("Failed to post receipt");
    } finally {
      setSaving(false);
    }
  }

  async function savePayment() {
    if (!editingPayment) return;
    if (!editingPayment.supplierId) {
      toast.error("Please select a vendor / supplier");
      return;
    }
    if (editingPayment.amount <= 0) {
      toast.error("Payment amount must be greater than zero");
      return;
    }

    setSaving(true);
    try {
      if (activeCompany?.id && activeFinancialYear?.id && user) {
        const idToken = await user.getIdToken();
        const supplier = suppliers.find((s) => s.id === editingPayment.supplierId);
        const supplierLedgerId = supplier?.ledgerId || `led_${activeCompany.id}_supp_${editingPayment.supplierId}`;

        await postPaymentTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          payment: editingPayment,
          supplierLedgerId,
          settlementLedgerId: editingPayment.settlementLedgerId,
          idToken,
          uid: user.uid,
        });
      }

      toast.success("Payment voucher posted & ledger updated");
      setOpenPayment(false);
      setEditingPayment(null);
    } catch (err) {
      console.error("Failed to post payment:", err);
      toast.error("Failed to post payment");
    } finally {
      setSaving(false);
    }
  }

  async function removeReceipt(id: string) {
    const r = await db().receipts.get(id);
    if (r?.invoiceId) {
      const inv = await db().invoices.get(r.invoiceId);
      if (inv) {
        inv.amountPaid = Math.max(0, inv.amountPaid - r.amount);
        inv.balance = Math.max(0, inv.grandTotal - inv.amountPaid);
        inv.status = inv.balance <= 0.01 ? "paid" : inv.amountPaid > 0 ? "partial" : "unpaid";
        await db().invoices.put(inv);
      }
    }
    await db().receipts.delete(id);
    toast.success("Receipt removed");
  }

  const custInvoices = editingReceipt
    ? invoices.filter((i) => i.customerId === editingReceipt.customerId && i.balance > 0)
    : [];

  return (
    <AppShell title="Receipts & Payments">
      <PageHeader
        title="Treasury & Settlement"
        description="Record customer receipts (Cash/Bank Dr | Customer Cr) and supplier payments (Supplier Dr | Cash/Bank Cr)."
        actions={
          <div className="flex items-center gap-2">
            <Button className="gap-2" onClick={openNewReceipt}>
              <ArrowDownLeft className="h-4 w-4 text-emerald-500" /> New Receipt
            </Button>
            <Button variant="outline" className="gap-2" onClick={openNewPayment}>
              <ArrowUpRight className="h-4 w-4 text-rose-500" /> New Payment
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="space-y-4">
        <TabsList className="grid w-72 grid-cols-2">
          <TabsTrigger value="receipts" className="gap-2">
            <ArrowDownLeft className="h-3.5 w-3.5" /> Receipts
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-2">
            <ArrowUpRight className="h-3.5 w-3.5" /> Payments
          </TabsTrigger>
        </TabsList>

        <TabsContent value="receipts" className="space-y-4">
          <ListToolbar query={q} onQuery={setQ} placeholder="Search by receipt number or customer name…" />
          {receipts.length === 0 ? (
            <EmptyState
              title="No customer receipts yet"
              description="Record payments received from customers to reconcile accounts receivable."
              action={
                <Button className="mt-2 gap-2" onClick={openNewReceipt}>
                  <Plus className="h-4 w-4" /> New Receipt
                </Button>
              }
            />
          ) : (
            <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
              <div className="overflow-x-auto scrollbar-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Settlement Mode</TableHead>
                      <TableHead>Voucher Link</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-20 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiptsPager.items.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono font-medium">{r.number}</TableCell>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell>{customers.find((c) => c.id === r.customerId)?.name ?? "—"}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {invoices.find((i) => i.id === r.invoiceId)?.number ?? "On account"}
                        </TableCell>
                        <TableCell className="uppercase text-xs font-semibold">{r.mode}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                            <BookOpen className="h-3.5 w-3.5 text-primary" />
                            <span>{r.voucherId ? "Posted" : "Local"}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                          {formatMoney(r.amount)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" onClick={() => setDeleteReceiptId(r.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
          <Pager {...receiptsPager} />
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm p-6">
            <div className="flex flex-col items-center justify-center gap-3 text-center py-8">
              <ArrowUpRight className="h-10 w-10 text-rose-500/70" />
              <div>
                <h3 className="text-base font-semibold">Supplier Payment Dispatches</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Click 'New Payment' to post debits to Supplier Payables against Cash or Bank Liquidity.
                </p>
              </div>
              <Button onClick={openNewPayment} className="gap-2 mt-2">
                <ArrowUpRight className="h-4 w-4" /> Record Supplier Payment
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* New Receipt Dialog */}
      <Dialog
        open={openReceipt}
        onOpenChange={(o) => {
          setOpenReceipt(o);
          if (!o) setEditingReceipt(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Record Customer Receipt</DialogTitle>
          </DialogHeader>
          {editingReceipt && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Receipt Number</Label>
                <Input value={editingReceipt.number} readOnly className="font-mono bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Receipt Date</Label>
                <Input
                  type="date"
                  value={toDateInput(editingReceipt.date)}
                  onChange={(e) =>
                    setEditingReceipt({ ...editingReceipt, date: fromDateInput(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Customer *</Label>
                <Select
                  value={editingReceipt.customerId}
                  onValueChange={(v) =>
                    setEditingReceipt({ ...editingReceipt, customerId: v, invoiceId: undefined })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Against Invoice</Label>
                <Select
                  value={editingReceipt.invoiceId || "none"}
                  onValueChange={(v) =>
                    setEditingReceipt({ ...editingReceipt, invoiceId: v === "none" ? undefined : v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="None (On account)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">On Account</SelectItem>
                    {custInvoices.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.number} · Bal {formatMoney(i.balance)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (₹) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editingReceipt.amount || ""}
                  onChange={(e) =>
                    setEditingReceipt({ ...editingReceipt, amount: Number(e.target.value) || 0 })
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select
                  value={editingReceipt.paymentMethod || editingReceipt.mode || "cash"}
                  onValueChange={(v: any) => {
                    const nextMethod = v;
                    const nextLedger = nextMethod === "cash"
                      ? (cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_cash`)
                      : (bankLedgers[0]?.id || cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_bank`);
                    setEditingReceipt({
                      ...editingReceipt,
                      mode: (v === "bank_transfer" ? "bank" : v) as any,
                      paymentMethod: nextMethod,
                      settlementLedgerId: nextLedger,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash in Hand</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</SelectItem>
                    <SelectItem value="upi">UPI / QR</SelectItem>
                    <SelectItem value="cheque">Bank Cheque</SelectItem>
                    <SelectItem value="card">Debit / Credit Card</SelectItem>
                    <SelectItem value="other">Other Settlement</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Settlement Ledger (Cash/Bank) *</Label>
                <Select
                  value={editingReceipt.settlementLedgerId || (editingReceipt.paymentMethod === "cash" ? cashLedgers[0]?.id : bankLedgers[0]?.id)}
                  onValueChange={(v) =>
                    setEditingReceipt({ ...editingReceipt, settlementLedgerId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Real Cash/Bank Ledger" />
                  </SelectTrigger>
                  <SelectContent>
                    {editingReceipt.paymentMethod === "cash" ? (
                      cashLedgers.length > 0 ? (
                        cashLedgers.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value={`led_${activeCompany?.id || "default"}_cash`}>Cash Account</SelectItem>
                      )
                    ) : (
                      bankLedgers.length > 0 ? (
                        bankLedgers.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value={`led_${activeCompany?.id || "default"}_bank`}>Bank Account</SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              {editingReceipt.paymentMethod === "cheque" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cheque Number</Label>
                    <Input
                      value={editingReceipt.chequeNumber || ""}
                      onChange={(e) => setEditingReceipt({ ...editingReceipt, chequeNumber: e.target.value })}
                      placeholder="e.g. 000123"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cheque Date</Label>
                    <Input
                      type="date"
                      value={editingReceipt.chequeDate || ""}
                      onChange={(e) => setEditingReceipt({ ...editingReceipt, chequeDate: e.target.value })}
                    />
                  </div>
                </>
              )}
              {editingReceipt.paymentMethod !== "cash" && editingReceipt.paymentMethod !== "cheque" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Transaction / UTR Reference</Label>
                  <Input
                    value={editingReceipt.reference || ""}
                    onChange={(e) => setEditingReceipt({ ...editingReceipt, reference: e.target.value })}
                    placeholder="e.g. UPI Ref / Bank UTR Number"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReceipt(false)}>
              Cancel
            </Button>
            <Button onClick={saveReceipt} disabled={saving}>
              {saving ? "Posting..." : "Post Receipt Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New Payment Dialog */}
      <Dialog
        open={openPayment}
        onOpenChange={(o) => {
          setOpenPayment(o);
          if (!o) setEditingPayment(null);
        }}
      >
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Record Supplier Payment</DialogTitle>
          </DialogHeader>
          {editingPayment && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Ref</Label>
                <Input value={editingPayment.number} readOnly className="font-mono bg-muted/40" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Date</Label>
                <Input
                  type="date"
                  value={toDateInput(editingPayment.date)}
                  onChange={(e) =>
                    setEditingPayment({ ...editingPayment, date: fromDateInput(e.target.value) })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Supplier / Vendor *</Label>
                <Select
                  value={editingPayment.supplierId}
                  onValueChange={(v) => setEditingPayment({ ...editingPayment, supplierId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select vendor…" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Amount (₹) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editingPayment.amount || ""}
                  onChange={(e) =>
                    setEditingPayment({ ...editingPayment, amount: Number(e.target.value) || 0 })
                  }
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Payment Method</Label>
                <Select
                  value={editingPayment.paymentMethod || editingPayment.mode || "bank"}
                  onValueChange={(v: any) => {
                    const nextMethod = v;
                    const nextLedger = nextMethod === "cash"
                      ? (cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_cash`)
                      : (bankLedgers[0]?.id || cashLedgers[0]?.id || `led_${activeCompany?.id || "default"}_bank`);
                    setEditingPayment({
                      ...editingPayment,
                      mode: (v === "bank_transfer" ? "bank" : v) as any,
                      paymentMethod: nextMethod,
                      settlementLedgerId: nextLedger,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank_transfer">Bank Transfer (NEFT/RTGS/IMPS)</SelectItem>
                    <SelectItem value="cash">Cash in Hand</SelectItem>
                    <SelectItem value="upi">UPI / QR</SelectItem>
                    <SelectItem value="cheque">Bank Cheque</SelectItem>
                    <SelectItem value="card">Company Card</SelectItem>
                    <SelectItem value="other">Other Payment</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Settlement Ledger (Cash/Bank) *</Label>
                <Select
                  value={editingPayment.settlementLedgerId || (editingPayment.paymentMethod === "cash" ? cashLedgers[0]?.id : bankLedgers[0]?.id)}
                  onValueChange={(v) =>
                    setEditingPayment({ ...editingPayment, settlementLedgerId: v })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select Real Cash/Bank Ledger" />
                  </SelectTrigger>
                  <SelectContent>
                    {editingPayment.paymentMethod === "cash" ? (
                      cashLedgers.length > 0 ? (
                        cashLedgers.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value={`led_${activeCompany?.id || "default"}_cash`}>Cash Account</SelectItem>
                      )
                    ) : (
                      bankLedgers.length > 0 ? (
                        bankLedgers.map((l) => (
                          <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                        ))
                      ) : (
                        <SelectItem value={`led_${activeCompany?.id || "default"}_bank`}>Bank Account</SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
              {editingPayment.paymentMethod === "cheque" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cheque Number</Label>
                    <Input
                      value={editingPayment.chequeNumber || ""}
                      onChange={(e) => setEditingPayment({ ...editingPayment, chequeNumber: e.target.value })}
                      placeholder="e.g. 000123"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cheque Date</Label>
                    <Input
                      type="date"
                      value={editingPayment.chequeDate || ""}
                      onChange={(e) => setEditingPayment({ ...editingPayment, chequeDate: e.target.value })}
                    />
                  </div>
                </>
              )}
              {editingPayment.paymentMethod !== "cash" && editingPayment.paymentMethod !== "cheque" && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label className="text-xs">Transaction / UTR Reference</Label>
                  <Input
                    value={editingPayment.reference || ""}
                    onChange={(e) => setEditingPayment({ ...editingPayment, reference: e.target.value })}
                    placeholder="e.g. UPI Ref / Bank UTR Number"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenPayment(false)}>
              Cancel
            </Button>
            <Button onClick={savePayment} disabled={saving}>
              {saving ? "Posting..." : "Post Payment Voucher"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteReceiptId)}
        onOpenChange={(v) => !v && setDeleteReceiptId(null)}
        title="Delete Receipt?"
        description="This will remove the receipt record and adjust outstanding invoice balances."
        onConfirm={() => {
          if (deleteReceiptId) removeReceipt(deleteReceiptId);
          setDeleteReceiptId(null);
        }}
      />
    </AppShell>
  );
}
