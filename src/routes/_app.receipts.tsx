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
import { useEffect, useState, useMemo } from "react";
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
import { HandCoins, ArrowDownLeft, ArrowUpRight, Plus, Trash2, BookOpen, Loader2, Printer, RotateCcw, AlertTriangle, ShieldCheck } from "lucide-react";
import { ListToolbar, usePagination, Pager, EmptyState } from "@/components/app/ListHelpers";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { postReceiptTransaction, postPaymentTransaction } from "@/modules/accounting/services/documentPostingService";
import { processAdvanceRefund } from "@/modules/accounting/services/partyAdvanceService";
import { calculateAdvanceTax } from "@/modules/tax/taxEngine";
import { downloadDocumentPDF, type NormalizedDocument } from "@/lib/documentRenderer";
import { createCompanySnapshot } from "@/modules/company/types";
import { createSignatorySnapshot } from "@/modules/company/signatoryHelper";
import { reconcileDocumentPostSuccess } from "@/lib/reconciliation";
import { authoritativeDeleteDraft, authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";

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

  // Advance Refund state
  const [refundReceipt, setRefundReceipt] = useState<Receipt | null>(null);
  const [refundAmount, setRefundAmount] = useState<number>(0);
  const [refundReason, setRefundReason] = useState<string>("");
  const [refundLedgerId, setRefundLedgerId] = useState<string>("");
  const [refunding, setRefunding] = useState<boolean>(false);

  const filteredReceipts = receipts.filter(
    (r) =>
      !q ||
      r.number.toLowerCase().includes(q.toLowerCase()) ||
      (customers.find((c) => c.id === r.customerId)?.name.toLowerCase().includes(q.toLowerCase()) ?? false)
  );
  const receiptsPager = usePagination(filteredReceipts, 12);

  // Live Advance Tax Preview for the modal
  const advanceTaxPreview = useMemo(() => {
    if (!editingReceipt || editingReceipt.allocationType !== "ADVANCE" || !editingReceipt.amount) {
      return null;
    }
    const cust = customers.find((c) => c.id === editingReceipt.customerId);
    const supplyType = editingReceipt.supplyType || "GOODS";
    const gstRate = editingReceipt.taxProfileSnapshot?.gstRate ?? 18;
    const isTaxInclusive = editingReceipt.taxProfileSnapshot?.isTaxInclusive ?? true;
    const pos = editingReceipt.placeOfSupplySnapshot || cust?.stateCode || activeCompany?.stateCode || "27";
    const companyState = activeCompany?.stateCode || "27";

    return calculateAdvanceTax({
      advanceAmount: editingReceipt.amount,
      supplyType,
      taxInclusive: isTaxInclusive,
      gstRate,
      companyGstMode: activeCompany?.taxRegistrationMode || "NORMAL_GST",
      placeOfSupply: pos,
      companyStateCode: companyState,
      mixedBreakdown: editingReceipt.mixedBreakdown
        ? {
            goodsAmount: (editingReceipt.mixedBreakdown.goodsAmountPaise || 0) / 100,
            serviceAmount: (editingReceipt.mixedBreakdown.serviceAmountPaise || 0) / 100,
            serviceGstRate: gstRate,
            serviceIsTaxInclusive: isTaxInclusive,
          }
        : undefined,
    });
  }, [editingReceipt, customers, activeCompany]);

  function printReceiptVoucher(r: Receipt) {
    const customer = customers.find((c) => c.id === r.customerId);
    const comp = activeCompany || r.companySnapshot;
    const isAdvance = r.allocationType === "ADVANCE" || !r.invoiceId;
    const docData: NormalizedDocument = {
      kind: "receipt",
      title: isAdvance ? "ADVANCE RECEIPT VOUCHER" : "RECEIPT VOUCHER",
      number: r.number,
      date: r.date,
      company: comp ? createCompanySnapshot(comp) : {},
      party: {
        name: customer?.name || "Customer",
        company: customer?.company,
        gstin: customer?.gstin,
        pan: customer?.pan,
        phone: customer?.mobile,
        email: customer?.email,
        address: customer?.address,
        state: customer?.state,
      },
      items: [],
      subtotal: r.taxableAmountPaise ? r.taxableAmountPaise / 100 : r.amount,
      discountTotal: 0,
      cgstTotal: r.cgstPaise ? r.cgstPaise / 100 : 0,
      sgstTotal: r.sgstPaise ? r.sgstPaise / 100 : 0,
      igstTotal: r.igstPaise ? r.igstPaise / 100 : 0,
      cessTotal: r.cessPaise ? r.cessPaise / 100 : 0,
      gstTotal: r.totalTaxPaise ? r.totalTaxPaise / 100 : 0,
      roundOff: 0,
      grandTotal: r.amount,
      amountPaid: r.amount,
      balance: 0,
      notes: r.notes || r.narration,
      paymentMode: r.paymentMethod || r.mode,
      signatorySnapshot: r.signatorySnapshot,
      signatoryOverride: r.signatoryOverride,
      receiptDetails: {
        receiptVoucherNumber: r.receiptVoucherId || r.number,
        natureOfSupply: r.supplyType,
        placeOfSupply: r.placeOfSupplySnapshot || customer?.stateCode || comp?.stateCode,
        taxableAmount: r.taxableAmountPaise ? r.taxableAmountPaise / 100 : undefined,
        cgst: r.cgstPaise ? r.cgstPaise / 100 : undefined,
        sgst: r.sgstPaise ? r.sgstPaise / 100 : undefined,
        igst: r.igstPaise ? r.igstPaise / 100 : undefined,
        totalTax: r.totalTaxPaise ? r.totalTaxPaise / 100 : undefined,
        totalReceived: r.amount,
        paymentMethod: r.paymentMethod || r.mode,
        settlementLedgerName: r.settlementLedgerId,
        referenceNumber: r.reference || r.referenceNumber,
        narration: r.narration || (isAdvance ? `Customer Advance Received (${r.supplyType || "GOODS"})` : undefined),
      },
    };
    downloadDocumentPDF(docData, `Receipt-Voucher-${r.number}.pdf`);
  }

  function openRefundDialog(r: Receipt) {
    setRefundReceipt(r);
    const avail = r.advanceAvailablePaise !== undefined ? r.advanceAvailablePaise / 100 : Math.max(0, r.amount - ((r.refundAmountPaise || 0) / 100));
    setRefundAmount(avail);
    setRefundReason("Cancelled order / No supply fulfilled");
    setRefundLedgerId(r.settlementLedgerId || cashLedgers[0]?.id || "");
  }

  async function handleConfirmRefund() {
    if (!refundReceipt || !activeCompany?.id || !activeFinancialYear?.id || !user) return;
    if (refundAmount <= 0) {
      toast.error("Refund amount must be greater than zero");
      return;
    }
    setRefunding(true);
    try {
      const idToken = await user.getIdToken();
      const res = await processAdvanceRefund({
        receiptId: refundReceipt.id,
        companyId: activeCompany.id,
        financialYearId: activeFinancialYear.id,
        refundAmount: refundAmount,
        reason: refundReason,
        settlementLedgerId: refundLedgerId,
        idToken,
        uid: user.uid,
      });
      if (!res.success) {
        toast.error(res.error || "Failed to process advance refund");
      } else {
        toast.success("Advance refunded & ledger reversal posted");
        setRefundReceipt(null);
      }
    } catch (err: unknown) {
      console.error("Refund error:", err);
      toast.error("Failed to process refund");
    } finally {
      setRefunding(false);
    }
  }

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
      allocationType: "ON_ACCOUNT",
      supplyType: "GOODS",
      taxTreatment: "NO_ADVANCE_GST",
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
      if (editingReceipt.allocationType === "ADVANCE") {
        const cust = customers.find((c) => c.id === editingReceipt.customerId);
        const supplyType = editingReceipt.supplyType || "GOODS";
        const gstRate = editingReceipt.taxProfileSnapshot?.gstRate ?? 18;
        const isTaxInclusive = editingReceipt.taxProfileSnapshot?.isTaxInclusive ?? true;
        const pos = editingReceipt.placeOfSupplySnapshot || cust?.stateCode || activeCompany?.stateCode || "27";
        const companyState = activeCompany?.stateCode || "27";

        const calc = calculateAdvanceTax({
          advanceAmount: editingReceipt.amount,
          supplyType,
          taxInclusive: isTaxInclusive,
          gstRate,
          companyGstMode: activeCompany?.taxRegistrationMode || "NORMAL_GST",
          placeOfSupply: pos,
          companyStateCode: companyState,
          mixedBreakdown: editingReceipt.mixedBreakdown
            ? {
                goodsAmount: (editingReceipt.mixedBreakdown.goodsAmountPaise || 0) / 100,
                serviceAmount: (editingReceipt.mixedBreakdown.serviceAmountPaise || 0) / 100,
                serviceGstRate: gstRate,
                serviceIsTaxInclusive: isTaxInclusive,
              }
            : undefined,
        });

        editingReceipt.supplyType = supplyType;
        editingReceipt.taxTreatment = calc.taxTreatment;
        editingReceipt.advanceAmountPaise = calc.advanceAmountPaise;
        editingReceipt.taxableAmountPaise = calc.taxableAmountPaise;
        editingReceipt.cgstPaise = calc.cgstPaise;
        editingReceipt.sgstPaise = calc.sgstPaise;
        editingReceipt.igstPaise = calc.igstPaise;
        editingReceipt.cessPaise = calc.cessPaise;
        editingReceipt.totalTaxPaise = calc.totalTaxPaise;
        editingReceipt.advanceAvailablePaise = calc.advanceAmountPaise;
        editingReceipt.placeOfSupplySnapshot = pos;
        editingReceipt.taxProfileSnapshot = {
          gstRate,
          isTaxInclusive,
          taxTreatment: calc.taxTreatment,
        };
      }

      if (activeCompany?.id && activeFinancialYear?.id && user) {
        const idToken = await user.getIdToken();
        const customer = customers.find((c) => c.id === editingReceipt.customerId);
        const customerLedgerId = customer?.ledgerId || `led_${activeCompany.id}_cust_${editingReceipt.customerId}`;

        await postReceiptTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          receipt: editingReceipt,
          company: activeCompany || undefined,
          customerLedgerId,
          settlementLedgerId: editingReceipt.settlementLedgerId,
          idToken,
          uid: user.uid,
        });
      } else {
        const frozenReceipt: Receipt = {
          ...editingReceipt,
          companySnapshot:
            editingReceipt.companySnapshot ||
            (activeCompany ? createCompanySnapshot(activeCompany) : undefined),
          signatorySnapshot:
            editingReceipt.signatorySnapshot ||
            (activeCompany
              ? createSignatorySnapshot(
                  activeCompany,
                  editingReceipt.signatoryOverride,
                  editingReceipt.date
                )
              : undefined),
        };
        await db().receipts.put(frozenReceipt);
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
          if (activeCompany?.id) {
            reconcileDocumentPostSuccess({
              entityType: "invoice",
              companyId: activeCompany.id,
              document: inv,
              action: "update",
            });
          }
        }
      }

      if (activeCompany?.id) {
        reconcileDocumentPostSuccess({
          entityType: "receipt",
          companyId: activeCompany.id,
          document: editingReceipt,
          action: "create",
        });
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
          company: activeCompany || undefined,
          supplierLedgerId,
          settlementLedgerId: editingPayment.settlementLedgerId,
          idToken,
          uid: user.uid,
        });
      } else {
        await db().payments.put(editingPayment);
      }

      if (activeCompany?.id) {
        reconcileDocumentPostSuccess({
          entityType: "payment",
          companyId: activeCompany.id,
          document: editingPayment,
          action: "create",
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
    try {
      const r = await db().receipts.get(id);

      if (activeCompany?.id) {
        await authoritativeDeleteDraft({
          companyId: activeCompany.id,
          kind: "receipt",
          id,
          uid: user?.uid,
        });
      } else {
        await db().receipts.delete(id);
      }

      if (r?.invoiceId) {
        const inv = await db().invoices.get(r.invoiceId);
        if (inv) {
          inv.amountPaid = Math.max(0, inv.amountPaid - r.amount);
          inv.balance = Math.max(0, inv.grandTotal - inv.amountPaid);
          inv.status = inv.balance <= 0.01 ? "paid" : inv.amountPaid > 0 ? "partial" : "unpaid";
          if (activeCompany?.id) {
            await authoritativeSaveEntity({
              companyId: activeCompany.id,
              financialYearId: activeFinancialYear?.id,
              kind: "invoice",
              entity: inv,
              uid: user?.uid,
              action: "update",
            });
          } else {
            await db().invoices.put(inv);
          }
        }
      }

      toast.success("Receipt removed");
    } catch (err: any) {
      console.error("[removeReceipt] Failed to remove receipt from cloud:", err);
      toast.error(err?.message || "Failed to remove receipt from cloud");
    }
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
                      <TableHead>Receipt #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Customer</TableHead>
                      <TableHead>Nature of Supply</TableHead>
                      <TableHead>Advance / Tax Status</TableHead>
                      <TableHead>Settlement</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-28 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {receiptsPager.items.map((r) => {
                      const isAdvance = r.allocationType === "ADVANCE" || (!r.invoiceId && !r.allocatedInvoices?.length);
                      const isRefunded = r.postingStatus === "refunded" || (r.refundAmountPaise && r.refundAmountPaise >= Math.round(r.amount * 100));
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono font-medium">{r.number}</TableCell>
                          <TableCell>{formatDate(r.date)}</TableCell>
                          <TableCell>{customers.find((c) => c.id === r.customerId)?.name ?? "—"}</TableCell>
                          <TableCell>
                            {isAdvance ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-primary/10 text-primary">
                                {r.supplyType || "GOODS"} ADVANCE
                              </span>
                            ) : (
                              <span className="font-mono text-xs text-muted-foreground">
                                {invoices.find((i) => i.id === r.invoiceId)?.number ?? "On account"}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            {isAdvance ? (
                              r.taxTreatment === "ADVANCE_GST" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                  GST ₹{((r.totalTaxPaise || 0) / 100).toFixed(2)}
                                </span>
                              ) : r.taxTreatment === "PENDING_CLASSIFICATION" ? (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-500/10 text-yellow-700 dark:text-yellow-400">
                                  Pending Review
                                </span>
                              ) : (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-500/10 text-slate-600 dark:text-slate-400">
                                  No Advance GST
                                </span>
                              )
                            ) : (
                              <span className="text-xs text-muted-foreground">Settled</span>
                            )}
                          </TableCell>
                          <TableCell className="uppercase text-xs font-semibold">{r.mode}</TableCell>
                          <TableCell className="text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMoney(r.amount)}
                            {r.refundAmountPaise ? (
                              <div className="text-[10px] text-rose-500">
                                Ref: -{formatMoney(r.refundAmountPaise / 100)}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Print / Download Receipt Voucher"
                                onClick={() => printReceiptVoucher(r)}
                              >
                                <Printer className="h-4 w-4 text-primary" />
                              </Button>
                              {isAdvance && !isRefunded && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Refund Advance"
                                  onClick={() => openRefundDialog(r)}
                                >
                                  <RotateCcw className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                                </Button>
                              )}
                              <Button
                                size="icon"
                                variant="ghost"
                                title="Delete Receipt"
                                onClick={() => setDeleteReceiptId(r.id)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
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
                  onValueChange={(v) => {
                    const cust = customers.find((c) => c.id === v);
                    const isAdvanceCust = cust?.paymentPolicy === "ADVANCE";
                    setEditingReceipt({
                      ...editingReceipt,
                      customerId: v,
                      invoiceId: undefined,
                      allocationType: isAdvanceCust ? "ADVANCE" : "ON_ACCOUNT",
                      reference: isAdvanceCust ? `ADV-${editingReceipt.number}` : editingReceipt.reference,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select customer…" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {c.paymentPolicy === "ADVANCE" ? "• [ADVANCE]" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Allocation Type</Label>
                <Select
                  value={editingReceipt.allocationType || (editingReceipt.invoiceId ? "AGAINST_REF" : "ON_ACCOUNT")}
                  onValueChange={(v: "ADVANCE" | "AGAINST_REF" | "ON_ACCOUNT") => {
                    setEditingReceipt({
                      ...editingReceipt,
                      allocationType: v,
                      invoiceId: v === "AGAINST_REF" ? editingReceipt.invoiceId : undefined,
                      reference: v === "ADVANCE" ? (editingReceipt.reference || `ADV-${editingReceipt.number}`) : editingReceipt.reference,
                    });
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ADVANCE">Advance (Customer Deposit)</SelectItem>
                    <SelectItem value="AGAINST_REF">Against Invoice (Reference)</SelectItem>
                    <SelectItem value="ON_ACCOUNT">On Account (General)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editingReceipt.allocationType === "AGAINST_REF" && (
                <div className="space-y-1.5">
                  <Label className="text-xs">Against Invoice</Label>
                  <Select
                    value={editingReceipt.invoiceId || "none"}
                    onValueChange={(v) =>
                      setEditingReceipt({ ...editingReceipt, invoiceId: v === "none" ? undefined : v })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select invoice…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Select Invoice</SelectItem>
                      {custInvoices.map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.number} · Bal {formatMoney(i.balance)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Reference Number</Label>
                <Input
                  value={editingReceipt.reference || ""}
                  onChange={(e) => setEditingReceipt({ ...editingReceipt, reference: e.target.value })}
                  placeholder="e.g. ADV-00012 or Cheque #"
                />
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

              {/* PRD Addendum § 12: User-Friendly Advance Form */}
              {editingReceipt.allocationType === "ADVANCE" && (
                <div className="sm:col-span-2 space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold text-foreground">Advance For *</Label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant={(editingReceipt.supplyType || "GOODS") === "GOODS" ? "default" : "outline"}
                        className="text-xs justify-start h-8"
                        onClick={() => setEditingReceipt({ ...editingReceipt, supplyType: "GOODS" })}
                      >
                        Goods
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={editingReceipt.supplyType === "SERVICES" ? "default" : "outline"}
                        className="text-xs justify-start h-8"
                        onClick={() => setEditingReceipt({ ...editingReceipt, supplyType: "SERVICES" })}
                      >
                        Services
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={editingReceipt.supplyType === "MIXED" ? "default" : "outline"}
                        className="text-xs justify-start h-8"
                        onClick={() => setEditingReceipt({ ...editingReceipt, supplyType: "MIXED" })}
                      >
                        Goods + Services
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={editingReceipt.supplyType === "UNSPECIFIED" ? "default" : "outline"}
                        className="text-xs justify-start h-8"
                        onClick={() => setEditingReceipt({ ...editingReceipt, supplyType: "UNSPECIFIED" })}
                      >
                        Not decided yet
                      </Button>
                    </div>
                  </div>

                  {/* GOODS FLOW (PRD Addendum § 2) */}
                  {(editingReceipt.supplyType || "GOODS") === "GOODS" && (
                    <div className="text-xs text-muted-foreground bg-card/70 p-2.5 rounded-lg border border-border/50">
                      <p className="font-semibold text-foreground">Goods Advance (No Advance Output GST)</p>
                      <p className="mt-0.5 text-[11px]">
                        Cash/Bank Dr | Customer Advance Cr. Under GST Notification 66/2017-CT, advances on goods do not generate Output GST. Sales Revenue & GST will be recognized on the eventual Tax Invoice.
                      </p>
                    </div>
                  )}

                  {/* SERVICES FLOW (PRD Addendum § 3, § 4) */}
                  {editingReceipt.supplyType === "SERVICES" && (
                    <div className="space-y-3 bg-card/80 p-3 rounded-lg border border-border/60">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">GST Rate (%)</Label>
                          <Select
                            value={String(editingReceipt.taxProfileSnapshot?.gstRate ?? 18)}
                            onValueChange={(val) =>
                              setEditingReceipt({
                                ...editingReceipt,
                                taxProfileSnapshot: {
                                  ...(editingReceipt.taxProfileSnapshot || {}),
                                  gstRate: Number(val),
                                  isTaxInclusive: editingReceipt.taxProfileSnapshot?.isTaxInclusive ?? true,
                                },
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="18">18% (Standard Services)</SelectItem>
                              <SelectItem value="12">12%</SelectItem>
                              <SelectItem value="5">5%</SelectItem>
                              <SelectItem value="28">28%</SelectItem>
                              <SelectItem value="0">0% (Exempt)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px]">Tax Calculation</Label>
                          <Select
                            value={editingReceipt.taxProfileSnapshot?.isTaxInclusive !== false ? "inclusive" : "exclusive"}
                            onValueChange={(val) =>
                              setEditingReceipt({
                                ...editingReceipt,
                                taxProfileSnapshot: {
                                  ...(editingReceipt.taxProfileSnapshot || { gstRate: 18 }),
                                  isTaxInclusive: val === "inclusive",
                                },
                              })
                            }
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inclusive">Tax Inclusive (Gross)</SelectItem>
                              <SelectItem value="exclusive">Tax Exclusive (Base)</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-[11px]">Place of Supply (State)</Label>
                          <Input
                            className="h-8 text-xs"
                            placeholder="State Code (e.g. 27)"
                            value={
                              editingReceipt.placeOfSupplySnapshot ||
                              customers.find((c) => c.id === editingReceipt.customerId)?.stateCode ||
                              activeCompany?.stateCode ||
                              ""
                            }
                            onChange={(e) =>
                              setEditingReceipt({
                                ...editingReceipt,
                                placeOfSupplySnapshot: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>

                      {/* Authoritative Calculation Preview */}
                      {advanceTaxPreview && (
                        <div className="grid grid-cols-3 gap-2 p-2.5 rounded bg-muted/40 text-xs font-mono border border-border/40">
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Taxable Advance</span>
                            <span className="font-bold text-foreground">
                              {formatMoney(advanceTaxPreview.taxableAdvance)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">
                              {advanceTaxPreview.igstPaise > 0 ? "IGST (Inter-State)" : "CGST + SGST (Intra)"}
                            </span>
                            <span className="font-bold text-amber-600 dark:text-amber-400">
                              {formatMoney(advanceTaxPreview.totalTaxPaise / 100)}
                            </span>
                          </div>
                          <div>
                            <span className="text-[10px] text-muted-foreground block">Total Advance</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400">
                              {formatMoney(advanceTaxPreview.advanceAmountPaise / 100)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* MIXED GOODS + SERVICES (PRD Addendum § 8) */}
                  {editingReceipt.supplyType === "MIXED" && (
                    <div className="space-y-3 bg-card/80 p-3 rounded-lg border border-border/60">
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">Goods Advance (₹ - No Tax)</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs font-mono"
                            placeholder="0.00"
                            value={(editingReceipt.mixedBreakdown?.goodsAmountPaise || 0) / 100 || ""}
                            onChange={(e) => {
                              const goodsRs = Number(e.target.value) || 0;
                              const totalRs = editingReceipt.amount || 0;
                              const servRs = Math.max(0, totalRs - goodsRs);
                              setEditingReceipt({
                                ...editingReceipt,
                                mixedBreakdown: {
                                  goodsAmountPaise: Math.round(goodsRs * 100),
                                  serviceAmountPaise: Math.round(servRs * 100),
                                  serviceTaxablePaise: 0,
                                  serviceTaxPaise: 0,
                                },
                              });
                            }}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-[11px]">Service Advance (₹ - Taxable)</Label>
                          <Input
                            type="number"
                            className="h-8 text-xs font-mono"
                            placeholder="0.00"
                            value={(editingReceipt.mixedBreakdown?.serviceAmountPaise || 0) / 100 || ""}
                            onChange={(e) => {
                              const servRs = Number(e.target.value) || 0;
                              const goodsRs = Math.max(0, (editingReceipt.amount || 0) - servRs);
                              setEditingReceipt({
                                ...editingReceipt,
                                mixedBreakdown: {
                                  goodsAmountPaise: Math.round(goodsRs * 100),
                                  serviceAmountPaise: Math.round(servRs * 100),
                                  serviceTaxablePaise: 0,
                                  serviceTaxPaise: 0,
                                },
                              });
                            }}
                          />
                        </div>
                      </div>
                      {advanceTaxPreview && (
                        <div className="text-[11px] font-mono p-2 rounded bg-muted/40 flex justify-between">
                          <span>Goods (No GST): {formatMoney((editingReceipt.mixedBreakdown?.goodsAmountPaise || 0) / 100)}</span>
                          <span className="text-amber-600 dark:text-amber-400 font-semibold">
                            Service GST: {formatMoney(advanceTaxPreview.totalTaxPaise / 100)}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* NOT DECIDED YET (PRD Addendum § 7) */}
                  {editingReceipt.supplyType === "UNSPECIFIED" && (
                    <div className="flex items-start gap-2.5 text-xs bg-amber-500/10 border border-amber-500/30 p-2.5 rounded-lg text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                      <div>
                        <p className="font-semibold">Tax treatment will need review when this advance is allocated.</p>
                        <p className="text-[11px] opacity-90 mt-0.5">
                          Advance is recorded with taxTreatment = PENDING_CLASSIFICATION. No tax rate is assumed or guessed until the final supply is identified.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

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
            <Button onClick={saveReceipt} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording Receipt…
                </>
              ) : (
                "Post Receipt Voucher"
              )}
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
            <Button onClick={savePayment} disabled={saving} className="gap-1.5">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording Payment…
                </>
              ) : (
                "Post Payment Voucher"
              )}
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

      {/* PRD Addendum § 10: Advance Cancellation / Refund Dialog */}
      <Dialog
        open={Boolean(refundReceipt)}
        onOpenChange={(o) => {
          if (!o) setRefundReceipt(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RotateCcw className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Process Advance Refund
            </DialogTitle>
          </DialogHeader>
          {refundReceipt && (
            <div className="space-y-3.5 py-2 text-xs">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1 font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Receipt Voucher:</span>
                  <span className="font-semibold">{refundReceipt.number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Customer:</span>
                  <span className="font-semibold">
                    {customers.find((c) => c.id === refundReceipt.customerId)?.name || "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Supply Type:</span>
                  <span className="font-semibold text-primary">{refundReceipt.supplyType || "GOODS"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Original Advance:</span>
                  <span className="font-semibold">{formatMoney(refundReceipt.amount)}</span>
                </div>
                {refundReceipt.taxTreatment === "ADVANCE_GST" && (
                  <div className="flex justify-between text-amber-600 dark:text-amber-400">
                    <span>GST Accounted:</span>
                    <span className="font-semibold">{formatMoney((refundReceipt.totalTaxPaise || 0) / 100)}</span>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Refund Amount (₹) *</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={refundAmount || ""}
                  onChange={(e) => setRefundAmount(Number(e.target.value) || 0)}
                  placeholder="0.00"
                  className="font-mono text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Max refundable:{" "}
                  {formatMoney(
                    refundReceipt.advanceAvailablePaise !== undefined
                      ? refundReceipt.advanceAvailablePaise / 100
                      : Math.max(0, refundReceipt.amount - ((refundReceipt.refundAmountPaise || 0) / 100))
                  )}
                </p>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Reason for Refund *</Label>
                <Input
                  value={refundReason}
                  onChange={(e) => setRefundReason(e.target.value)}
                  placeholder="e.g. Order cancelled / Supply not feasible"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Refund From Account (Cash / Bank) *</Label>
                <Select
                  value={refundLedgerId}
                  onValueChange={(v) => setRefundLedgerId(v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select liquidity ledger" />
                  </SelectTrigger>
                  <SelectContent>
                    {cashLedgers.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name} (Cash)</SelectItem>
                    ))}
                    {bankLedgers.map((l) => (
                      <SelectItem key={l.id} value={l.id}>{l.name} (Bank)</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="rounded-md border border-amber-500/20 bg-amber-500/5 p-2.5 text-[11px] text-amber-800 dark:text-amber-300">
                Refund creates an authoritative reversal voucher. If advance GST was recognized, Output GST will be proportionally reversed. The receipt voucher is never deleted.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRefundReceipt(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleConfirmRefund}
              disabled={refunding || refundAmount <= 0}
              className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
            >
              {refunding ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Processing Refund…
                </>
              ) : (
                "Post Advance Refund"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
