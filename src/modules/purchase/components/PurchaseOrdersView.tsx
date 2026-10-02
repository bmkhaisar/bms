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
import { Plus, Pencil, Trash2, Download, Printer, Search, ArrowRight, Eye, CheckCircle2, Clock, XCircle, FileText, PackagePlus, ShoppingBag } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { db, uid, nextNumber, getCompany, type PurchaseOrder, type LineItem, type Supplier, type Product } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { computeLine, computeTotals } from "@/lib/calc";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";

interface PurchaseOrdersViewProps {
  onConvertToGrn?: (po: PurchaseOrder) => void;
  onConvertToPurchase?: (po: PurchaseOrder) => void;
}

export function PurchaseOrdersView({
  onConvertToGrn,
  onConvertToPurchase,
}: PurchaseOrdersViewProps) {
  const { activeCompany, activeFinancialYear, activeBranchId } = useActiveCompany();
  const { user } = useAuth();

  const purchaseOrders = useLive<PurchaseOrder>(() => db().purchaseOrders.orderBy("createdAt").reverse().toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [previewPo, setPreviewPo] = useState<PurchaseOrder | null>(null);
  const [editingPo, setEditingPo] = useState<PurchaseOrder | null>(null);

  // PO Form State
  const [poNumber, setPoNumber] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [notes, setNotes] = useState("");
  const [terms, setTerms] = useState("1. Goods to be delivered at factory premises.\n2. Payment terms: 30 days post delivery.");
  const [items, setItems] = useState<LineItem[]>([]);

  // Open New PO Modal
  const openNewPo = async () => {
    setEditingPo(null);
    const num = await nextNumber("purchase_order");
    setPoNumber(num);
    setPoDate(new Date().toISOString().slice(0, 10));
    setDueDate(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
    setSupplierId(suppliers[0]?.id || "");
    setNotes("");
    setTerms("1. Delivery within scheduled date.\n2. Taxes as applicable.\n3. Goods subject to inspection upon receipt.");
    setItems([
      {
        productId: products[0]?.id || "",
        name: products[0]?.name || "Item 1",
        quantity: 10,
        unit: products[0]?.unit || "PCS",
        rate: products[0]?.purchasePrice || 100,
        discountPct: 0,
        gstRate: products[0]?.gstRate ?? 18,
        taxable: 1000,
        gstAmount: 180,
        total: 1180,
      },
    ]);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const openEditPo = (po: PurchaseOrder) => {
    setEditingPo(po);
    setPoNumber(po.number);
    setPoDate(new Date(po.date).toISOString().slice(0, 10));
    setDueDate(po.dueDate ? new Date(po.dueDate).toISOString().slice(0, 10) : "");
    setSupplierId(po.supplierId);
    setNotes(po.notes || "");
    setTerms(po.terms || "");
    setItems(po.items || []);
    setIsModalOpen(true);
  };

  // Line Items Helper
  const addItem = () => {
    const p = products[0];
    const raw: LineItem = {
      productId: p?.id || "",
      name: p?.name || "New Item",
      quantity: 1,
      unit: p?.unit || "PCS",
      rate: p?.purchasePrice || 0,
      discountPct: 0,
      gstRate: p?.gstRate ?? 18,
      taxable: 0,
      gstAmount: 0,
      total: 0,
    };
    const computed = computeLine(raw);
    setItems((prev) => [...prev, computed]);
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
          merged.rate = prod.purchasePrice || 0;
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
      toast.error("Purchase order must have at least 1 line item.");
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Totals
  const totals = useMemo(() => {
    return computeTotals(items, false);
  }, [items]);

  const taxableAmount = totals.subtotal - totals.discountTotal;

  // Save PO
  const handleSavePo = async () => {
    if (!supplierId) {
      toast.error("Please select a supplier");
      return;
    }
    if (items.length === 0) {
      toast.error("Add at least 1 item to the purchase order");
      return;
    }

    const sup = suppliers.find((s) => s.id === supplierId);
    const poPayload: PurchaseOrder = {
      id: editingPo ? editingPo.id : uid(),
      number: poNumber,
      date: new Date(poDate).getTime(),
      dueDate: dueDate ? new Date(dueDate).getTime() : undefined,
      supplierId,
      supplierSnapshot: sup ? { id: sup.id, name: sup.name, gstin: sup.gstin, mobile: sup.mobile, address: sup.address } : undefined,
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
      notes,
      terms,
      status: editingPo ? editingPo.status : "open",
      createdAt: editingPo ? editingPo.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    await db().purchaseOrders.put(poPayload);
    toast.success(editingPo ? "Purchase Order updated" : "Purchase Order created successfully");
    setIsModalOpen(false);
  };

  // Delete PO
  const handleDeletePo = async (id: string) => {
    if (confirm("Are you sure you want to delete this Purchase Order?")) {
      await db().purchaseOrders.delete(id);
      toast.success("Purchase Order deleted");
    }
  };

  // Filtered PO list
  const filteredOrders = useMemo(() => {
    return purchaseOrders.filter((po) => {
      if (statusFilter !== "all" && po.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchesNum = po.number.toLowerCase().includes(q);
        const matchesSup = (po.supplierSnapshot?.name || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesSup) return false;
      }
      return true;
    });
  }, [purchaseOrders, statusFilter, search]);

  // Excel Export
  const exportToExcel = () => {
    const rows = filteredOrders.map((po) => ({
      "PO Number": po.number,
      "PO Date": formatDate(po.date),
      "Due Date": po.dueDate ? formatDate(po.dueDate) : "",
      "Supplier Name": po.supplierSnapshot?.name || "Supplier",
      "Supplier GSTIN": po.supplierSnapshot?.gstin || "",
      "Items Count": po.items?.length || 0,
      "Taxable Amount": po.taxableAmount || po.subtotal,
      "GST Total": po.gstTotal,
      "Grand Total": po.grandTotal,
      "Status": (po.status || "open").toUpperCase(),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Purchase Orders");
    XLSX.writeFile(wb, `Purchase_Orders_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("Purchase orders exported to Excel");
  };

  // Print PDF for PO
  const printPoPDF = async (po: PurchaseOrder) => {
    const comp = await getCompany(activeCompany?.id);
    const doc = new jsPDF();

    // Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(comp.name || "Business Enterprise", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    if (comp.address) doc.text(comp.address, 14, 24);
    if (comp.gstin) doc.text(`GSTIN: ${comp.gstin} | Mobile: ${comp.mobile || ""}`, 14, 29);

    // Title Badge
    doc.setFillColor(30, 64, 175);
    doc.roundedRect(140, 12, 56, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("PURCHASE ORDER", 145, 20);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`PO No: ${po.number}`, 140, 30);
    doc.text(`Date: ${formatDate(po.date)}`, 140, 35);
    if (po.dueDate) doc.text(`Delivery Due: ${formatDate(po.dueDate)}`, 140, 40);

    // Supplier Box
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(14, 46, 182, 22, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.text("VENDOR / SUPPLIER DETAILS:", 18, 52);
    doc.setFont("helvetica", "normal");
    doc.text(po.supplierSnapshot?.name || "Supplier", 18, 58);
    if (po.supplierSnapshot?.gstin) doc.text(`GSTIN: ${po.supplierSnapshot.gstin}`, 18, 63);
    if (po.supplierSnapshot?.mobile) doc.text(`Phone: ${po.supplierSnapshot.mobile}`, 110, 58);
    if (po.supplierSnapshot?.address) doc.text(`Address: ${po.supplierSnapshot.address}`, 110, 63);

    // Items Table
    const tableData = (po.items || []).map((it, idx) => [
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
      headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
      foot: [
        ["", "", "", "", "", "", "Taxable Amount:", formatMoney(po.taxableAmount || po.subtotal), ""],
        ["", "", "", "", "", "", "GST Total:", formatMoney(po.gstTotal), ""],
        ["", "", "", "", "", "", "Grand Total:", formatMoney(po.grandTotal), ""],
      ],
      footStyles: { fillColor: [245, 245, 245], textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8 },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;
    if (po.terms) {
      doc.setFont("helvetica", "bold");
      doc.text("Terms & Conditions:", 14, finalY);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const splitTerms = doc.splitTextToSize(po.terms, 180);
      doc.text(splitTerms, 14, finalY + 5);
    }

    doc.save(`${po.number}.pdf`);
    toast.success(`PDF downloaded for ${po.number}`);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Orders</span>
            <ShoppingBag className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{purchaseOrders.length}</div>
          <div className="text-[10px] text-muted-foreground">All POs created</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Open Orders</span>
            <Clock className="h-4 w-4 text-amber-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-amber-700 dark:text-amber-400">
            {purchaseOrders.filter((p) => p.status === "open").length}
          </div>
          <div className="text-[10px] text-muted-foreground">Awaiting delivery</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Received / Fulfilled</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {purchaseOrders.filter((p) => p.status === "received").length}
          </div>
          <div className="text-[10px] text-muted-foreground">Completed orders</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Value</span>
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-lg font-bold text-foreground">
            {formatMoney(purchaseOrders.reduce((sum, p) => sum + (p.grandTotal || 0), 0))}
          </div>
          <div className="text-[10px] text-muted-foreground">Committed procurement</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search PO #, supplier..."
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
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="partially_received">Partially Received</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
              <Download className="h-3.5 w-3.5" />
              <span>Excel Export</span>
            </Button>
            <Button size="sm" onClick={openNewPo} className="gap-1.5 text-xs h-9">
              <Plus className="h-3.5 w-3.5" />
              <span>New Purchase Order</span>
            </Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card className="overflow-hidden border border-border/70 card-soft">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/40 text-[11px] uppercase font-semibold text-muted-foreground">
                <TableHead>PO Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Delivery Due</TableHead>
                <TableHead className="text-right">Taxable</TableHead>
                <TableHead className="text-right">GST</TableHead>
                <TableHead className="text-right">Total Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-44">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No purchase orders found. Click &quot;New Purchase Order&quot; to create one.
                  </TableCell>
                </TableRow>
              ) : (
                filteredOrders.map((po) => (
                  <TableRow key={po.id} className="text-xs hover:bg-secondary/20">
                    <TableCell className="font-mono font-bold text-primary">{po.number}</TableCell>
                    <TableCell>{formatDate(po.date)}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{po.supplierSnapshot?.name || "Supplier"}</div>
                      {po.supplierSnapshot?.gstin && (
                        <div className="text-[10px] font-mono text-muted-foreground">GSTIN: {po.supplierSnapshot.gstin}</div>
                      )}
                    </TableCell>
                    <TableCell>{po.dueDate ? formatDate(po.dueDate) : "—"}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(po.taxableAmount || po.subtotal)}</TableCell>
                    <TableCell className="text-right font-mono">{formatMoney(po.gstTotal)}</TableCell>
                    <TableCell className="text-right font-mono font-bold">{formatMoney(po.grandTotal)}</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={`text-[10px] capitalize ${
                          po.status === "received"
                            ? "bg-emerald-500/10 text-emerald-700"
                            : po.status === "cancelled"
                            ? "bg-rose-500/10 text-rose-700"
                            : "bg-amber-500/10 text-amber-700"
                        }`}
                      >
                        {po.status || "open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        {onConvertToGrn && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
                            title="Convert to Goods Receipt Note (GRN)"
                            onClick={() => onConvertToGrn(po)}
                          >
                            <PackagePlus className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-blue-600 hover:bg-blue-500/10"
                          title="Print / Save PDF"
                          onClick={() => printPoPDF(po)}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit Purchase Order"
                          onClick={() => openEditPo(po)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          title="Delete Purchase Order"
                          onClick={() => handleDeletePo(po.id)}
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

      {/* Create / Edit Purchase Order Dialog */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-base font-bold">
              {editingPo ? `Edit Purchase Order (${editingPo.number})` : "Create Purchase Order"}
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 overflow-y-auto flex-1 space-y-4 text-xs">
            {/* Header Form */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">PO Number *</Label>
                <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} className="text-xs h-8 font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">PO Date *</Label>
                <Input type="date" value={poDate} onChange={(e) => setPoDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Delivery Due Date</Label>
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Supplier *</Label>
                <Select value={supplierId} onValueChange={setSupplierId}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Select Supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name} {s.gstin ? `(${s.gstin})` : ""}
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

            {/* Terms & Totals */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="space-y-2">
                <div className="space-y-1">
                  <Label className="text-xs">Terms & Delivery Conditions</Label>
                  <Textarea
                    rows={3}
                    value={terms}
                    onChange={(e) => setTerms(e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Internal Notes</Label>
                  <Input
                    placeholder="e.g. Approved by Purchase Manager"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="text-xs h-8"
                  />
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
            <Button size="sm" onClick={handleSavePo}>
              {editingPo ? "Update Purchase Order" : "Create Purchase Order"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
