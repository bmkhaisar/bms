import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Pencil, Trash2, Download, Printer, Search, ArrowRight, FileCheck, ShoppingCart, Clock, CheckCircle2, FileText, Package } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { db, uid, nextNumber, getCompany, type SalesOrder, type LineItem, type Customer, type Product, type Invoice } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { computeLine, computeTotals } from "@/lib/calc";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useNavigate } from "@tanstack/react-router";
import { documentDeepLink } from "@/lib/useDocumentDeepLink";

interface SalesOrdersViewProps {
  onConvertToInvoice?: (so: SalesOrder) => void;
}

export function SalesOrdersView({ onConvertToInvoice }: SalesOrdersViewProps) {
  const { activeCompany, activeFinancialYear, activeBranchId } = useActiveCompany();
  const navigate = useNavigate();

  const salesOrders = useLive<SalesOrder>(() => db().salesOrders.orderBy("createdAt").reverse().toArray());
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSo, setEditingSo] = useState<SalesOrder | null>(null);

  // Form states
  const [soNumber, setSoNumber] = useState("");
  const [soDate, setSoDate] = useState(new Date().toISOString().slice(0, 10));
  const [deliveryDate, setDeliveryDate] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [advanceReceived, setAdvanceReceived] = useState("0");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("1. Delivery within promised timeframe.\n2. Goods inspected prior to dispatch.\n3. Payment as per agreed credit terms.");
  const [items, setItems] = useState<LineItem[]>([]);

  // Open New SO
  const openNewSo = async () => {
    setEditingSo(null);
    const num = await nextNumber("sales_order");
    setSoNumber(num);
    setSoDate(new Date().toISOString().slice(0, 10));
    setDeliveryDate(new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10));
    setCustomerId(customers[0]?.id || "");
    setAdvanceReceived("0");
    setNotes("");
    setTerms("1. Goods once dispatched cannot be cancelled.\n2. Warranty as per manufacturer norms.");
    
    const p = products[0];
    setItems([
      {
        productId: p?.id || "",
        name: p?.name || "Item 1",
        quantity: 1,
        unit: p?.unit || "PCS",
        rate: p?.sellingPrice || 100,
        discountPct: 0,
        gstRate: p?.gstRate ?? 18,
        taxable: 100,
        gstAmount: 18,
        total: 118,
      },
    ]);
    setIsModalOpen(true);
  };

  // Open Edit SO
  const openEditSo = (so: SalesOrder) => {
    setEditingSo(so);
    setSoNumber(so.number);
    setSoDate(new Date(so.date).toISOString().slice(0, 10));
    setDeliveryDate(so.deliveryDate ? new Date(so.deliveryDate).toISOString().slice(0, 10) : "");
    setCustomerId(so.customerId);
    setAdvanceReceived(String(so.advanceReceived || 0));
    setNotes(so.notes || "");
    setTerms(so.terms || "");
    setItems(so.items || []);
    setIsModalOpen(true);
  };

  // Line items helpers
  const addItem = () => {
    const p = products[0];
    const raw: LineItem = {
      productId: p?.id || "",
      name: p?.name || "New Item",
      quantity: 1,
      unit: p?.unit || "PCS",
      rate: p?.sellingPrice || 0,
      discountPct: 0,
      gstRate: p?.gstRate ?? 18,
      taxable: 0,
      gstAmount: 0,
      total: 0,
    };
    setItems((prev) => [...prev, computeLine(raw)]);
  };

  const updateItem = (index: number, partial: Partial<LineItem>) => {
    setItems((prev) => {
      const next = [...prev];
      const merged = { ...next[index], ...partial };
      if (partial.productId && partial.productId !== next[index].productId) {
        const prod = products.find((p) => p.id === partial.productId);
        if (prod) {
          merged.name = prod.name;
          merged.unit = prod.unit || "PCS";
          merged.rate = prod.sellingPrice || 0;
          merged.gstRate = prod.gstRate ?? 18;
          merged.hsn = prod.hsn;
        }
      }
      next[index] = computeLine(merged);
      return next;
    });
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) {
      toast.error("Sales order must have at least 1 line item.");
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Totals
  const totals = useMemo(() => {
    return computeTotals(items, false);
  }, [items]);

  const taxableAmount = totals.subtotal - totals.discountTotal;

  // Save SO
  const handleSaveSo = async () => {
    if (!customerId) {
      toast.error("Please select a customer");
      return;
    }
    if (items.length === 0) {
      toast.error("Please add at least 1 item");
      return;
    }

    const cust = customers.find((c) => c.id === customerId);
    const soPayload: SalesOrder = {
      id: editingSo ? editingSo.id : uid(),
      number: soNumber,
      date: new Date(soDate).getTime(),
      deliveryDate: deliveryDate ? new Date(deliveryDate).getTime() : undefined,
      customerId,
      customerSnapshot: cust ? { id: cust.id, name: cust.name, gstin: cust.gstin, mobile: cust.mobile, address: cust.address } : undefined,
      companyId: activeCompany?.id,
      branchId: activeBranchId && activeBranchId !== "all" ? activeBranchId : undefined,
      financialYearId: activeFinancialYear?.id,
      items,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      taxableAmount,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      gstTotal: totals.gstTotal,
      roundOff: totals.roundOff,
      grandTotal: totals.grandTotal,
      advanceReceived: parseFloat(advanceReceived) || 0,
      notes,
      terms,
      status: editingSo ? editingSo.status : "open",
      createdAt: editingSo ? editingSo.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    await db().salesOrders.put(soPayload);
    toast.success(editingSo ? "Sales order updated" : "Sales order created successfully");
    setIsModalOpen(false);
  };

  // 1-Click Convert to Invoice
  const handleConvertSoToInvoice = async (so: SalesOrder) => {
    if (onConvertToInvoice) {
      onConvertToInvoice(so);
      return;
    }

    try {
      const invNum = await nextNumber("invoice");
      const newInvoice: Invoice = {
        id: uid(),
        number: invNum,
        date: Date.now(),
        customerId: so.customerId,
        customerSnapshot: so.customerSnapshot,
        companyId: activeCompany?.id,
        branchId: so.branchId,
        financialYearId: activeFinancialYear?.id,
        items: so.items,
        subtotal: so.subtotal,
        discountTotal: so.discountTotal,
        taxableAmount: so.taxableAmount,
        cgstTotal: so.cgstTotal,
        sgstTotal: so.sgstTotal,
        igstTotal: so.igstTotal,
        gstTotal: so.gstTotal,
        roundOff: so.roundOff,
        grandTotal: so.grandTotal,
        amountPaid: so.advanceReceived || 0,
        balance: Math.max(0, so.grandTotal - (so.advanceReceived || 0)),
        isIgst: (so.igstTotal || 0) > 0,
        status: (so.advanceReceived || 0) >= so.grandTotal ? "paid" : (so.advanceReceived || 0) > 0 ? "partial" : "unpaid",
        notes: `Converted from Sales Order ${so.number}`,
        createdAt: Date.now(),
      };

      await db().invoices.put(newInvoice);
      await db().salesOrders.update(so.id, {
        status: "completed",
        convertedInvoiceId: newInvoice.id,
        convertedInvoiceNumber: newInvoice.number,
      });

      toast.success(`Sales Order ${so.number} converted to Invoice ${newInvoice.number}!`);
      navigate({ to: documentDeepLink("/invoices", newInvoice.id) as never });
    } catch (err: any) {
      toast.error(`Failed to convert: ${err?.message || "Internal error"}`);
    }
  };

  // Delete SO
  const handleDeleteSo = async (id: string) => {
    if (confirm("Are you sure you want to delete this Sales Order?")) {
      await db().salesOrders.delete(id);
      toast.success("Sales order deleted");
    }
  };

  // Filtered list
  const filteredOrders = useMemo(() => {
    return salesOrders.filter((so) => {
      if (statusFilter !== "all" && so.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchesNum = so.number.toLowerCase().includes(q);
        const matchesCust = (so.customerSnapshot?.name || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesCust) return false;
      }
      return true;
    });
  }, [salesOrders, statusFilter, search]);

  // Export to Excel
  const exportToExcel = () => {
    const data = filteredOrders.map((so) => ({
      "SO Number": so.number,
      "Order Date": formatDate(so.date),
      "Delivery Due": so.deliveryDate ? formatDate(so.deliveryDate) : "—",
      "Customer Name": so.customerSnapshot?.name || "Customer",
      "Customer GSTIN": so.customerSnapshot?.gstin || "Unregistered",
      "Items Count": so.items?.length || 0,
      "Taxable Value": so.taxableAmount || so.subtotal,
      "GST Total": so.gstTotal,
      "Grand Total": so.grandTotal,
      "Advance Received": so.advanceReceived || 0,
      "Status": (so.status || "open").toUpperCase(),
      "Linked Invoice": so.convertedInvoiceNumber || "—",
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sales Orders");
    XLSX.writeFile(wb, `Sales_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Sales Orders exported to Excel");
  };

  // Print PDF
  const printSoPDF = async (so: SalesOrder) => {
    const comp = await getCompany(activeCompany?.id);
    const doc = new jsPDF();

    // Company Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(comp.name || "Business Enterprise", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    if (comp.address) doc.text(comp.address, 14, 24);
    if (comp.gstin) doc.text(`GSTIN: ${comp.gstin} | Mobile: ${comp.mobile || ""}`, 14, 29);

    // Title Badge
    doc.setFillColor(37, 99, 235);
    doc.roundedRect(140, 12, 56, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("SALES ORDER", 148, 20);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`SO No: ${so.number}`, 140, 30);
    doc.text(`Date: ${formatDate(so.date)}`, 140, 35);
    if (so.deliveryDate) doc.text(`Delivery Date: ${formatDate(so.deliveryDate)}`, 140, 40);

    // Customer Box
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(14, 46, 182, 22, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.text("BUYER / CUSTOMER DETAILS:", 18, 52);
    doc.setFont("helvetica", "normal");
    doc.text(so.customerSnapshot?.name || "Customer", 18, 58);
    if (so.customerSnapshot?.gstin) doc.text(`GSTIN: ${so.customerSnapshot.gstin}`, 18, 63);
    if (so.customerSnapshot?.mobile) doc.text(`Phone: ${so.customerSnapshot.mobile}`, 110, 58);
    if (so.customerSnapshot?.address) doc.text(`Address: ${so.customerSnapshot.address}`, 110, 63);

    // Items Table
    const tableData = (so.items || []).map((it, idx) => [
      idx + 1,
      it.name,
      it.hsn || "—",
      `${it.quantity} ${it.unit}`,
      formatMoney(it.rate),
      `${it.discountPct || 0}%`,
      `${it.gstRate || 0}%`,
      formatMoney(it.taxable || (it.quantity * it.rate)),
      formatMoney(it.total),
    ]);

    autoTable(doc, {
      startY: 72,
      head: [["#", "Item Description", "HSN", "Qty", "Rate", "Disc%", "GST%", "Taxable", "Total"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [37, 99, 235], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      foot: [
        ["", "", "", "", "", "", "Taxable Amount:", formatMoney(so.taxableAmount || so.subtotal), ""],
        ["", "", "", "", "", "", "GST Total:", formatMoney(so.gstTotal), ""],
        ["", "", "", "", "", "", "Grand Total:", formatMoney(so.grandTotal), ""],
      ],
      footStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;
    if (so.terms) {
      doc.setFont("helvetica", "bold");
      doc.text("Terms & Conditions:", 14, finalY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const splitTerms = doc.splitTextToSize(so.terms, 180);
      doc.text(splitTerms, 14, finalY + 5);
    }

    doc.save(`${so.number}.pdf`);
    toast.success(`PDF downloaded for ${so.number}`);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Orders</span>
            <ShoppingCart className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{salesOrders.length}</div>
          <div className="text-[10px] text-muted-foreground">Customer orders booked</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Open Orders</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">
            {salesOrders.filter((s) => s.status === "open").length}
          </div>
          <div className="text-[10px] text-muted-foreground">Awaiting fulfillment</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Invoiced / Completed</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {salesOrders.filter((s) => s.status === "completed").length}
          </div>
          <div className="text-[10px] text-muted-foreground">Converted to invoice</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Order Book</span>
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">
            {formatMoney(salesOrders.reduce((sum, s) => sum + (s.grandTotal || 0), 0))}
          </div>
          <div className="text-[10px] text-muted-foreground">Confirmed sales pipeline</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search SO #, customer..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-36 text-xs h-9">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="completed">Completed / Invoiced</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
              <Download className="h-3.5 w-3.5" />
              <span>Excel Export</span>
            </Button>
            <Button size="sm" onClick={openNewSo} className="gap-1.5 text-xs h-9">
              <Plus className="h-3.5 w-3.5" />
              <span>New Sales Order</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Orders Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead>SO Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Delivery Date</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total (₹)</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-44">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No sales orders found. Click &quot;New Sales Order&quot; to book an order.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((so) => (
                  <TableRow key={so.id} className="text-xs hover:bg-secondary/20">
                    <TableCell className="font-mono font-bold text-primary">{so.number}</TableCell>
                    <TableCell>{formatDate(so.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{so.customerSnapshot?.name || "Customer"}</div>
                      {so.customerSnapshot?.gstin && (
                        <div className="text-[10px] font-mono text-muted-foreground">GSTIN: {so.customerSnapshot.gstin}</div>
                      )}
                    </TableCell>
                    <TableCell>{so.deliveryDate ? formatDate(so.deliveryDate) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(so.taxableAmount || so.subtotal)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(so.gstTotal)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(so.grandTotal)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] capitalize ${
                          so.status === "completed"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : so.status === "cancelled"
                            ? "bg-rose-500/10 text-rose-700"
                            : "bg-blue-500/10 text-blue-700"
                        }`}
                      >
                        {so.status || "open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {so.status !== "completed" && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
                            title="Convert to GST Invoice"
                            onClick={() => handleConvertSoToInvoice(so)}
                          >
                            <FileCheck className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-blue-600 hover:bg-blue-500/10"
                          title="Print / Save PDF"
                          onClick={() => printSoPDF(so)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit Sales Order"
                          onClick={() => openEditSo(so)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          title="Delete Sales Order"
                          onClick={() => handleDeleteSo(so.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-base font-bold">
              {editingSo ? `Edit Sales Order (${editingSo.number})` : "Create Sales Order"}
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 overflow-y-auto flex-1 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">SO Number *</Label>
                <Input value={soNumber} onChange={(e) => setSoNumber(e.target.value)} className="text-xs h-8 font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Order Date *</Label>
                <Input type="date" value={soDate} onChange={(e) => setSoDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delivery Due Date</Label>
                <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Customer *</Label>
                <Select value={customerId} onValueChange={setCustomerId}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Select Customer" />
                  </SelectTrigger>
                  <SelectContent>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id} className="text-xs">
                        {c.name} {c.gstin ? `(${c.gstin})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Line Items */}
            <div className="space-y-2 pt-2 border-t border-border/70">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Order Line Items</Label>
                <Button size="sm" variant="outline" onClick={addItem} className="gap-1 text-xs h-7">
                  <Plus className="h-3 w-3" /> Add Item
                </Button>
              </div>

              <div className="border border-border/70 rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/40 text-[10px] uppercase font-semibold text-muted-foreground">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead className="w-64">Product / Item</TableHead>
                      <TableHead className="w-24 text-right">Qty</TableHead>
                      <TableHead className="w-20">Unit</TableHead>
                      <TableHead className="w-28 text-right">Rate (₹)</TableHead>
                      <TableHead className="w-20 text-right">GST %</TableHead>
                      <TableHead className="w-28 text-right">Amount (₹)</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((it, idx) => (
                      <TableRow key={idx} className="text-xs">
                        <TableCell className="font-mono text-muted-foreground">{idx + 1}</TableCell>
                        <TableCell>
                          <Select
                            value={it.productId}
                            onValueChange={(val) => updateItem(idx, { productId: val })}
                          >
                            <SelectTrigger className="text-xs h-7">
                              <SelectValue placeholder="Select product" />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id} className="text-xs">
                                  {p.name} {p.sku ? `(${p.sku})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min="1"
                            value={it.quantity}
                            onChange={(e) => updateItem(idx, { quantity: parseFloat(e.target.value) || 0 })}
                            className="text-xs h-7 text-right font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.unit}
                            onChange={(e) => updateItem(idx, { unit: e.target.value.toUpperCase() })}
                            className="text-xs h-7 uppercase font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            step="0.01"
                            value={it.rate}
                            onChange={(e) => updateItem(idx, { rate: parseFloat(e.target.value) || 0 })}
                            className="text-xs h-7 text-right font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Select
                            value={String(it.gstRate ?? 18)}
                            onValueChange={(val) => updateItem(idx, { gstRate: parseFloat(val) })}
                          >
                            <SelectTrigger className="text-xs h-7">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="0" className="text-xs">0%</SelectItem>
                              <SelectItem value="5" className="text-xs">5%</SelectItem>
                              <SelectItem value="12" className="text-xs">12%</SelectItem>
                              <SelectItem value="18" className="text-xs">18%</SelectItem>
                              <SelectItem value="28" className="text-xs">28%</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          ₹{it.total.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            onClick={() => removeItem(idx)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Terms, Advance & Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Terms & Dispatch Notes</Label>
                  <Textarea
                    rows={2}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Advance Received (₹)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={advanceReceived}
                      onChange={(e) => setAdvanceReceived(e.target.value)}
                      className="text-xs h-8 font-mono"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Internal Notes</Label>
                    <Input
                      placeholder="e.g. Approved order"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="text-xs h-8"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5 bg-secondary/30 p-3 rounded-lg text-xs font-mono">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal:</span>
                  <span>{formatMoney(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Taxable Value:</span>
                  <span>{formatMoney(taxableAmount)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST Total:</span>
                  <span>{formatMoney(totals.gstTotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>Round Off:</span>
                  <span>{formatMoney(totals.roundOff)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold text-foreground border-t border-border/70 pt-1.5 font-mono">
                  <span>Grand Total:</span>
                  <span>{formatMoney(totals.grandTotal)}</span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="p-3 border-t gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveSo}>
              {editingSo ? "Update Sales Order" : "Book Sales Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
