import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { db, type Invoice, type SalesReturn, type CreditNote, type Customer } from "@/lib/db";
import { useLive, useLiveState } from "@/lib/useLive";
import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { formatMoney, formatDate } from "@/lib/format";
import {
  RotateCcw,
  Plus,
  Eye,
  Download,
  Search,
  FileText,
  AlertCircle,
  CheckCircle2,
  Package,
  Layers,
  Building,
  Loader2,
  Calendar,
} from "lucide-react";
import { postSalesReturn } from "@/functions/salesReturnFn";
import { getSalesReturnNormalizedDoc } from "@/modules/salesReturns/salesReturnDocumentHelper";
import { downloadDocumentPDF, buildDocumentPDF } from "@/lib/documentRenderer";
import { useBusinessScope } from "@/modules/company/context/BusinessScopeContext";
import { ExportDialog } from "@/components/app/ExportDialog";
import { CREDIT_NOTE_EXPORT_COLUMNS } from "@/modules/export/exportColumnDefinitions";
import { FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_app/sales-returns")({
  head: () => ({ meta: [{ title: "Sales Returns & Credit Notes — BMS NEXT" }] }),
  component: SalesReturnsPage,
});

const RETURN_REASONS = [
  "Defective Goods",
  "Damaged in Transit",
  "Wrong Item Supplied",
  "Customer Return / Cancellation",
  "Price or Quantity Adjustment",
  "Other Reason",
];

function SalesReturnsPage() {
  const { user } = useAuth();
  const { activeCompany, activeBranchId, branches, can, isOwner } = useActiveCompany();
  const { scope, filterRecords } = useBusinessScope();

  // Queries
  const allSalesReturnsState = useLiveState<SalesReturn>(() =>
    db().salesReturns.orderBy("date").reverse().toArray()
  );
  const allInvoices = useLive<Invoice>(() =>
    db().invoices.orderBy("date").reverse().toArray()
  );
  const customers = useLive<Customer>(() =>
    db().customers.orderBy("name").toArray()
  );

  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBranchFilter, setSelectedBranchFilter] = useState<string>("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<SalesReturn | null>(null);

  // Form State for Return Creation
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>("");
  const [returnItems, setReturnItems] = useState<
    Array<{
      invoiceItemId: string;
      name: string;
      maxQty: number;
      returnQty: number;
      rate: number;
      gstRate: number;
      restockOption: "RESTOCK_SALEABLE" | "RESTOCK_DAMAGED" | "FINANCIAL_CREDIT_ONLY";
    }>
  >([]);
  const [reason, setReason] = useState<string>("Defective Goods");
  const [notes, setNotes] = useState<string>("");
  const [isPosting, setIsPosting] = useState(false);

  // Active branch context & business scope filtering
  const scopedSalesReturns = useMemo(() => {
    let list = filterRecords(allSalesReturnsState.data || [], "date");

    if (activeBranchId && activeBranchId !== "all") {
      list = list.filter((r) => r.branchId === activeBranchId);
    } else if (selectedBranchFilter !== "all") {
      list = list.filter((r) => r.branchId === selectedBranchFilter);
    }

    return list;
  }, [allSalesReturnsState.data, filterRecords, activeBranchId, selectedBranchFilter]);

  const filteredSalesReturns = useMemo(() => {
    let list = scopedSalesReturns;

    // Filter by search
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.number?.toLowerCase().includes(q) ||
          r.creditNoteNumber?.toLowerCase().includes(q) ||
          r.originalInvoiceNumber?.toLowerCase().includes(q) ||
          r.customerSnapshot?.name?.toLowerCase().includes(q)
      );
    }

    return list;
  }, [scopedSalesReturns, searchTerm]);

  // Available invoices for creating returns
  const returnableInvoices = useMemo(() => {
    let list = (allInvoices || []).filter(
      (inv) => inv.status === "paid" || inv.status === "posted" || Boolean((inv as any).isFinalized)
    );
    if (activeBranchId && activeBranchId !== "all") {
      list = list.filter((inv) => inv.branchId === activeBranchId);
    }
    return list;
  }, [allInvoices, activeBranchId]);

  // Selected invoice object
  const selectedInvoice = useMemo(() => {
    return returnableInvoices.find((inv) => inv.id === selectedInvoiceId);
  }, [returnableInvoices, selectedInvoiceId]);

  // Map of previously returned quantities per line item for the selected invoice
  const previouslyReturnedMap = useMemo(() => {
    if (!selectedInvoiceId) return {};
    const map: Record<string, number> = {};
    const relatedReturns = (allSalesReturnsState.data || []).filter(
      (r) => r.originalInvoiceId === selectedInvoiceId && r.status !== "cancelled" && r.status !== "reversed"
    );
    for (const ret of relatedReturns) {
      for (const it of ret.items || []) {
        map[it.invoiceItemId] = (map[it.invoiceItemId] || 0) + (it.returnQuantity || 0);
      }
    }
    return map;
  }, [selectedInvoiceId, allSalesReturnsState.data]);

  // When invoice selection changes, populate line items with max returnable qty
  const handleSelectInvoice = (invId: string) => {
    setSelectedInvoiceId(invId);
    const inv = returnableInvoices.find((i) => i.id === invId);
    if (!inv || !inv.items) {
      setReturnItems([]);
      return;
    }

    const items = inv.items.map((it, idx) => {
      const itemId = it.id || (it as any).productId || `item_${idx}`;
      const prevReturned = previouslyReturnedMap[itemId] || 0;
      const remaining = Math.max(0, it.quantity - prevReturned);
      return {
        invoiceItemId: itemId,
        name: it.name,
        maxQty: remaining,
        returnQty: 0,
        rate: it.rate,
        gstRate: it.gstRate || 0,
        restockOption: "RESTOCK_SALEABLE" as const,
      };
    });

    setReturnItems(items);
  };

  // Compute live totals for return modal
  const returnTotals = useMemo(() => {
    let taxable = 0;
    let totalTax = 0;
    let selectedCount = 0;

    const isInterState = Boolean(selectedInvoice?.isIgst);

    for (const it of returnItems) {
      if (it.returnQty > 0) {
        selectedCount++;
        const lineTaxable = it.returnQty * it.rate;
        const lineTax = (lineTaxable * it.gstRate) / 100;
        taxable += lineTaxable;
        totalTax += lineTax;
      }
    }

    const grandTotal = Math.round(taxable + totalTax);

    // Outstanding vs Credit analysis
    const invBalance = selectedInvoice?.balance ?? (selectedInvoice?.grandTotal || 0);
    const arReduction = Math.min(invBalance, grandTotal);
    const customerCredit = Math.max(0, grandTotal - arReduction);

    return {
      selectedCount,
      taxable,
      totalTax,
      grandTotal,
      isInterState,
      arReduction,
      customerCredit,
    };
  }, [returnItems, selectedInvoice]);

  // Handle Return Creation Submit
  const handleCreateReturn = async () => {
    if (!activeCompany?.id) {
      toast.error("No active company selected");
      return;
    }
    if (!selectedInvoice) {
      toast.error("Please select an original invoice");
      return;
    }

    const mappedReason = (
      reason.includes("Defective") ? "Defective" :
      reason.includes("Damaged") ? "Damaged" :
      reason.includes("Wrong") ? "Wrong Item" :
      reason.includes("Price") ? "Price Adjustment" :
      reason.includes("Customer") ? "Customer Return" : "Other"
    ) as "Defective" | "Damaged" | "Wrong Item" | "Customer Return" | "Price Adjustment" | "Other";

    const isFullReturn = returnItems.every((it) => it.returnQty >= it.maxQty && it.maxQty > 0);

    const itemsToReturn = returnItems
      .filter((it) => it.returnQty > 0)
      .map((it) => ({
        invoiceItemId: it.invoiceItemId,
        returnQuantity: it.returnQty,
        reason: mappedReason,
        reasonNotes: notes || undefined,
        restockAction: it.restockOption,
      }));

    if (itemsToReturn.length === 0) {
      toast.error("Please enter a return quantity greater than 0 for at least one item");
      return;
    }

    const targetBranchId = selectedInvoice.branchId;
    if (!targetBranchId) {
      toast.error("Selected invoice is missing an assigned branch. Please run the legacy branch migration.");
      return;
    }

    setIsPosting(true);
    try {
      const res = await postSalesReturn({
        companyId: activeCompany.id,
        branchId: targetBranchId,
        originalInvoiceId: selectedInvoice.id,
        date: Date.now(),
        returnType: isFullReturn ? "FULL" : "PARTIAL",
        items: itemsToReturn,
        notes,
      });

      if (!res.success) {
        toast.error(res.error || "Failed to post sales return");
        return;
      }

      // Save locally to BizDB
      if (res.salesReturn) {
        await db().salesReturns.put(res.salesReturn);
      }
      if (res.creditNote) {
        await db().creditNotes.put(res.creditNote);
      }

      toast.success(
        `Sales Return posted! Credit Note: ${res.creditNote?.number || res.salesReturn?.creditNoteNumber}`
      );
      setIsCreateOpen(false);
      setSelectedInvoiceId("");
      setReturnItems([]);
      setNotes("");
    } catch (err: any) {
      toast.error(err.message || "An unexpected error occurred");
    } finally {
      setIsPosting(false);
    }
  };

  // KPIs
  const kpiData = useMemo(() => {
    let totalValue = 0;
    let totalGst = 0;
    let totalCreditGenerated = 0;

    for (const r of filteredSalesReturns) {
      if (r.status !== "cancelled" && r.status !== "reversed") {
        totalValue += r.grandTotal || 0;
        totalGst += r.gstTotal || 0;
        totalCreditGenerated += (r.customerCreditCreated || (r.customerCreditGeneratedPaise ? r.customerCreditGeneratedPaise / 100 : 0));
      }
    }

    return {
      count: filteredSalesReturns.length,
      totalValue,
      totalGst,
      totalCreditGenerated,
    };
  }, [filteredSalesReturns]);

  return (
    <AppShell title="Sales Returns & Credit Notes">
      <div className="space-y-6">
        <PageHeader
          title="Sales Returns & Credit Notes"
          description="Process customer returns, issue authoritative credit notes, and record automated inventory restock and GST reversals."
          actions={
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={() => setIsExportOpen(true)}
                className="gap-2 shadow-xs"
                title="Export Credit Notes & Returns"
              >
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                Export
              </Button>
              {can("SALES_RETURN_CREATE") ? (
                <Button
                  onClick={() => setIsCreateOpen(true)}
                  className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                >
                  <Plus className="h-4 w-4" />
                  New Sales Return
                </Button>
              ) : null}
            </div>
          }
        />

        {/* KPI Cards */}
        {(() => {
          const activeBranchName =
            activeBranchId === "all"
              ? "All Branches (Consolidated)"
              : branches.find((b) => b.id === activeBranchId)?.name || "Current Branch";
          const activeCompanyName = activeCompany?.name || "Active Organization";

          return (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* 1. Total Returns */}
              <Card className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-soft flex items-center justify-between gap-3 min-h-[100px]">
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate leading-none">
                    Total Returns
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate h-8 flex items-center mt-1.5 font-mono">
                    {formatMoney(kpiData.totalValue)}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate leading-none mt-1">
                    {kpiData.count} return document{kpiData.count !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center self-center">
                  <RotateCcw className="h-5 w-5" />
                </div>
              </Card>

              {/* 2. GST Liability Reversal */}
              <Card className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-soft flex items-center justify-between gap-3 min-h-[100px]">
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate leading-none">
                    GST Liability Reversal
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400 truncate h-8 flex items-center mt-1.5 font-mono">
                    {formatMoney(kpiData.totalGst)}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate leading-none mt-1">
                    Output tax adjusted
                  </div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center self-center">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
              </Card>

              {/* 3. Customer Credit Issued */}
              <Card className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-soft flex items-center justify-between gap-3 min-h-[100px]">
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate leading-none">
                    Customer Credit Issued
                  </div>
                  <div className="text-xl sm:text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400 truncate h-8 flex items-center mt-1.5 font-mono">
                    {formatMoney(kpiData.totalCreditGenerated)}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate leading-none mt-1">
                    From fully paid invoices
                  </div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center self-center">
                  <FileText className="h-5 w-5" />
                </div>
              </Card>

              {/* 4. Active Scope */}
              <Card className="rounded-2xl border border-border/80 bg-card p-4 sm:p-5 shadow-soft flex items-center justify-between gap-3 min-h-[100px]">
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground truncate leading-none">
                    Active Scope
                  </div>
                  <div
                    className="text-lg sm:text-xl font-bold tracking-tight text-foreground truncate h-8 flex items-center mt-1.5"
                    title={activeBranchName}
                  >
                    {activeBranchName}
                  </div>
                  <div
                    className="text-[11px] text-muted-foreground truncate leading-none mt-1"
                    title={activeCompanyName}
                  >
                    {activeCompanyName}
                  </div>
                </div>
                <div className="h-10 w-10 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center self-center">
                  <Layers className="h-5 w-5" />
                </div>
              </Card>
            </div>
          );
        })()}

        {/* Toolbar & Filters */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-card p-3 rounded-xl border border-border/60 shadow-xs">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search Credit Note #, Return #, Customer..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9"
            />
          </div>

          {activeBranchId === "all" && isOwner && (
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Filter Branch:</span>
              <Select value={selectedBranchFilter} onValueChange={setSelectedBranchFilter}>
                <SelectTrigger className="h-9 w-full sm:w-48">
                  <SelectValue placeholder="All Branches" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Branches</SelectItem>
                  {branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        {/* Sales Returns Table */}
        <Card className="border-border/60 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="w-28">Date</TableHead>
                  <TableHead>Credit Note #</TableHead>
                  <TableHead>Orig Invoice</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Return Value</TableHead>
                  <TableHead className="text-right">GST Adj</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredSalesReturns.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-32 text-center text-muted-foreground">
                      <div className="flex flex-col items-center justify-center gap-1.5">
                        <RotateCcw className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-sm font-medium">No sales returns found</p>
                        <p className="text-xs text-muted-foreground">
                          {can("SALES_RETURN_CREATE")
                            ? "Click 'New Sales Return' to record a customer return against a posted invoice."
                            : "No returns recorded in this branch."}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredSalesReturns.map((r) => {
                    const branchName =
                      branches.find((b) => b.id === r.branchId)?.name || r.branchId || "Main";
                    return (
                      <TableRow key={r.id} className="hover:bg-muted/30">
                        <TableCell className="text-xs font-medium text-muted-foreground whitespace-nowrap">
                          {formatDate(r.date)}
                        </TableCell>
                        <TableCell className="font-semibold text-foreground whitespace-nowrap">
                          {r.creditNoteNumber || r.number}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground whitespace-nowrap">
                          {r.originalInvoiceNumber}
                        </TableCell>
                        <TableCell className="font-medium max-w-[180px] truncate">
                          {r.customerSnapshot?.name || "Customer"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          <Badge variant="outline" className="text-[10px] font-normal py-0">
                            {branchName}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                          {r.reason || (r as any).reasonNotes || "Returned Goods"}
                        </TableCell>
                        <TableCell className="text-right font-bold text-foreground whitespace-nowrap">
                          {formatMoney(r.grandTotal)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-emerald-600 dark:text-emerald-400 font-medium whitespace-nowrap">
                          {formatMoney(r.gstTotal)}
                        </TableCell>
                        <TableCell className="text-center whitespace-nowrap">
                          <Badge
                            variant={
                              r.status === "cancelled"
                                ? "destructive"
                                : (r.customerCreditCreated && r.customerCreditCreated > 0) || (r.customerCreditGeneratedPaise && r.customerCreditGeneratedPaise > 0)
                                ? "secondary"
                                : "default"
                            }
                            className="text-[10px]"
                          >
                            {(r.customerCreditCreated && r.customerCreditCreated > 0) || (r.customerCreditGeneratedPaise && r.customerCreditGeneratedPaise > 0)
                              ? "Credit Created"
                              : "AR Reduced"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Preview PDF"
                              onClick={() => setPreviewDoc(r)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              title="Download PDF"
                              onClick={() => {
                                const doc = getSalesReturnNormalizedDoc(
                                  r,
                                  activeCompany,
                                  customers.find((c) => c.id === r.customerId)
                                );
                                downloadDocumentPDF(
                                  doc,
                                  `Credit-Note-${r.creditNoteNumber || r.number}.pdf`
                                );
                              }}
                            >
                              <Download className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </Card>

        {/* Create Sales Return Wizard Modal */}
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <RotateCcw className="h-5 w-5 text-primary" />
                Create Sales Return & Credit Note
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-5 py-2">
              {/* Step 1: Select Original Invoice */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  1. Select Posted Invoice *
                </Label>
                <Select value={selectedInvoiceId} onValueChange={handleSelectInvoice}>
                  <SelectTrigger className="h-10">
                    <SelectValue placeholder="Choose an original invoice to return against..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-60">
                    {returnableInvoices.map((inv) => (
                      <SelectItem key={inv.id} value={inv.id}>
                        {inv.number} — {inv.customerSnapshot?.name || "Customer"} — {formatMoney(inv.grandTotal)} ({formatDate(inv.date)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedInvoice && (
                <>
                  {/* Invoice Context Box */}
                  <div className="rounded-lg border border-border/70 bg-muted/30 p-3 text-xs grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                      <span className="text-muted-foreground block">Customer:</span>
                      <span className="font-semibold text-foreground">
                        {selectedInvoice.customerSnapshot?.name || "Customer"}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Invoice Date:</span>
                      <span className="font-medium text-foreground">
                        {formatDate(selectedInvoice.date)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Invoice Total:</span>
                      <span className="font-medium text-foreground">
                        {formatMoney(selectedInvoice.grandTotal)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block">Outstanding Balance:</span>
                      <span className="font-bold text-foreground">
                        {formatMoney(selectedInvoice.balance ?? selectedInvoice.grandTotal)}
                      </span>
                    </div>
                  </div>

                  {/* Step 2: Line Items to Return */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        2. Select Items to Return & Quantities
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        {returnTotals.selectedCount} item{returnTotals.selectedCount !== 1 ? "s" : ""} selected
                      </span>
                    </div>

                    <div className="rounded-lg border border-border/70 overflow-hidden">
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40 text-[11px]">
                            <TableHead>Item Name</TableHead>
                            <TableHead className="text-right">Rate</TableHead>
                            <TableHead className="text-right">Available Qty</TableHead>
                            <TableHead className="w-24 text-right">Return Qty</TableHead>
                            <TableHead className="w-48">Restock Destination</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {returnItems.map((item, idx) => (
                            <TableRow key={item.invoiceItemId} className="text-xs">
                              <TableCell className="font-medium">
                                {item.name}
                                <span className="block text-[10px] text-muted-foreground font-normal">
                                  GST: {item.gstRate}%
                                </span>
                              </TableCell>
                              <TableCell className="text-right text-muted-foreground">
                                {formatMoney(item.rate)}
                              </TableCell>
                              <TableCell className="text-right font-medium">
                                {item.maxQty}
                              </TableCell>
                              <TableCell className="text-right">
                                <Input
                                  type="number"
                                  min={0}
                                  max={item.maxQty}
                                  value={item.returnQty || ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const val = Math.min(
                                      item.maxQty,
                                      Math.max(0, Number(e.target.value) || 0)
                                    );
                                    const next = [...returnItems];
                                    next[idx].returnQty = val;
                                    setReturnItems(next);
                                  }}
                                  className="h-8 text-right text-xs"
                                  disabled={item.maxQty <= 0}
                                />
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={item.restockOption}
                                  onValueChange={(val: any) => {
                                    const next = [...returnItems];
                                    next[idx].restockOption = val;
                                    setReturnItems(next);
                                  }}
                                  disabled={item.returnQty <= 0}
                                >
                                  <SelectTrigger className="h-8 text-xs">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="RESTOCK_SALEABLE">
                                      Yes — Saleable Stock
                                    </SelectItem>
                                    <SelectItem value="RESTOCK_DAMAGED">
                                      Yes — Damaged / Quarantine
                                    </SelectItem>
                                    <SelectItem value="FINANCIAL_CREDIT_ONLY">
                                      No — Financial Credit Only
                                    </SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>

                  {/* Step 3: Reason & Notes */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        3. Return Reason *
                      </Label>
                      <Select value={reason} onValueChange={setReason}>
                        <SelectTrigger className="h-9">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {RETURN_REASONS.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        4. Free-Text Notes (Optional)
                      </Label>
                      <Input
                        placeholder="e.g. Return inspection notes..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="h-9 text-xs"
                      />
                    </div>
                  </div>

                  {/* Financial & Accounting Impact Summary Box */}
                  <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between border-b border-primary/10 pb-2">
                      <span className="font-semibold text-foreground text-sm flex items-center gap-1.5">
                        <FileText className="h-4 w-4 text-primary" />
                        Credit Note & Accounting Summary
                      </span>
                      <span className="font-bold text-sm text-foreground">
                        Total Credit: {formatMoney(returnTotals.grandTotal)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1 text-muted-foreground">
                      <div>
                        <span>Taxable Amount:</span>{" "}
                        <strong className="text-foreground font-semibold">
                          {formatMoney(returnTotals.taxable)}
                        </strong>
                      </div>
                      <div>
                        <span>GST Adjustment:</span>{" "}
                        <strong className="text-emerald-600 dark:text-emerald-400 font-semibold">
                          {formatMoney(returnTotals.totalTax)}
                        </strong>
                      </div>
                      <div>
                        <span>Supply Type:</span>{" "}
                        <strong className="text-foreground font-semibold">
                          {returnTotals.isInterState ? "IGST (Inter-State)" : "CGST + SGST (Intra-State)"}
                        </strong>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-primary/10 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px]">
                      <div className="flex items-center gap-1.5 text-foreground font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        <span>AR Outstanding Reduction: <strong>{formatMoney(returnTotals.arReduction)}</strong></span>
                      </div>
                      {returnTotals.customerCredit > 0 && (
                        <div className="flex items-center gap-1.5 text-indigo-700 dark:text-indigo-400 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5 text-indigo-600" />
                          <span>Customer Credit Generated: <strong>{formatMoney(returnTotals.customerCredit)}</strong></span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isPosting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateReturn}
                disabled={isPosting || !selectedInvoice || returnTotals.selectedCount === 0}
                className="gap-2 bg-primary hover:bg-primary/90 text-primary-foreground"
              >
                {isPosting && <Loader2 className="h-4 w-4 animate-spin" />}
                Post Sales Return & Credit Note
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Preview PDF Modal */}
        {previewDoc && (
          <Dialog open={Boolean(previewDoc)} onOpenChange={() => setPreviewDoc(null)}>
            <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-6">
              <DialogHeader className="flex flex-row items-center justify-between pb-3 border-b border-border/70">
                <DialogTitle className="text-base font-semibold flex items-center gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  Credit Note: {previewDoc.creditNoteNumber || previewDoc.number}
                </DialogTitle>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-xs h-8"
                    onClick={() => {
                      const doc = getSalesReturnNormalizedDoc(
                        previewDoc,
                        activeCompany,
                        customers.find((c) => c.id === previewDoc.customerId)
                      );
                      downloadDocumentPDF(
                        doc,
                        `Credit-Note-${previewDoc.creditNoteNumber || previewDoc.number}.pdf`
                      );
                    }}
                  >
                    <Download className="h-3.5 w-3.5" />
                    Download PDF
                  </Button>
                </div>
              </DialogHeader>

              {/* Render vector PDF blob in iframe */}
              <div className="flex-1 w-full min-h-[500px] border border-border/60 rounded-lg overflow-hidden bg-muted/20">
                <iframe
                  title="Credit Note Preview"
                  className="w-full h-full min-h-[500px]"
                  src={URL.createObjectURL(
                    buildDocumentPDF(
                      getSalesReturnNormalizedDoc(
                        previewDoc,
                        activeCompany,
                        customers.find((c) => c.id === previewDoc.customerId)
                      )
                    ).output("blob")
                  )}
                />
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* Export Dialog */}
        <ExportDialog
          open={isExportOpen}
          onOpenChange={setIsExportOpen}
          title="Export Sales Returns & Credit Notes"
          filename={`Credit_Notes_${new Date().toISOString().split("T")[0]}`}
          columns={CREDIT_NOTE_EXPORT_COLUMNS}
          filteredData={filteredSalesReturns}
          allScopeData={scopedSalesReturns}
        />
      </div>
    </AppShell>
  );
}
