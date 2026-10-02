import { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Pencil, Trash2, Download, Printer, Search, CheckCircle2, Clock, Truck, PackageCheck, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { db, uid, nextNumber, getCompany, type PurchaseGrn, type PurchaseGrnItem, type PurchaseOrder, type Supplier, type Product } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { formatDate } from "@/lib/format";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";

interface PurchaseGrnViewProps {
  initialPo?: PurchaseOrder | null;
  onClearInitialPo?: () => void;
}

export function PurchaseGrnView({
  initialPo,
  onClearInitialPo,
}: PurchaseGrnViewProps) {
  const { activeCompany, activeFinancialYear, activeBranchId } = useActiveCompany();

  const grns = useLive<PurchaseGrn>(() => db().purchaseGrns.orderBy("createdAt").reverse().toArray());
  const purchaseOrders = useLive<PurchaseOrder>(() => db().purchaseOrders.orderBy("createdAt").reverse().toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const products = useLive<Product>(() => db().products.orderBy("name").toArray());

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingGrn, setEditingGrn] = useState<PurchaseGrn | null>(null);

  // GRN Form State
  const [grnNumber, setGrnNumber] = useState("");
  const [grnDate, setGrnDate] = useState(new Date().toISOString().slice(0, 10));
  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [challanNumber, setChallanNumber] = useState("");
  const [challanDate, setChallanDate] = useState("");
  const [transporter, setTransporter] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<PurchaseGrnItem[]>([]);

  // Open New GRN
  const openNewGrn = async (po?: PurchaseOrder) => {
    setEditingGrn(null);
    const num = await nextNumber("purchase_grn");
    setGrnNumber(num);
    setGrnDate(new Date().toISOString().slice(0, 10));
    setChallanNumber("");
    setChallanDate(new Date().toISOString().slice(0, 10));
    setTransporter("");
    setVehicleNumber("");
    setNotes("");

    if (po) {
      setPoId(po.id);
      setSupplierId(po.supplierId);
      setItems(
        (po.items || []).map((it) => ({
          productId: it.productId,
          name: it.name,
          sku: it.sku,
          hsn: it.hsn,
          unit: it.unit || "PCS",
          rate: it.rate,
          orderedQty: it.quantity,
          receivedQty: it.quantity,
          acceptedQty: it.quantity,
          rejectedQty: 0,
          warehouseLocation: "Main Warehouse",
        }))
      );
    } else {
      setPoId("");
      setSupplierId(suppliers[0]?.id || "");
      const p = products[0];
      setItems([
        {
          productId: p?.id || "",
          name: p?.name || "Item 1",
          sku: p?.sku,
          hsn: p?.hsn,
          unit: p?.unit || "PCS",
          rate: p?.purchasePrice || 0,
          orderedQty: 10,
          receivedQty: 10,
          acceptedQty: 10,
          rejectedQty: 0,
          warehouseLocation: "Main Warehouse",
        },
      ]);
    }
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const openEditGrn = (grn: PurchaseGrn) => {
    setEditingGrn(grn);
    setGrnNumber(grn.number);
    setGrnDate(new Date(grn.date).toISOString().slice(0, 10));
    setSupplierId(grn.supplierId);
    setPoId(grn.purchaseOrderId || "");
    setChallanNumber(grn.challanNumber || "");
    setChallanDate(grn.challanDate ? String(grn.challanDate) : "");
    setTransporter(grn.transporter || "");
    setVehicleNumber(grn.vehicleNumber || "");
    setNotes(grn.notes || "");
    setItems(grn.items || []);
    setIsModalOpen(true);
  };

  // Helper when PO is selected in form
  const handleSelectPo = (selectedPoId: string) => {
    setPoId(selectedPoId);
    if (!selectedPoId) return;
    const po = purchaseOrders.find((p) => p.id === selectedPoId);
    if (po) {
      setSupplierId(po.supplierId);
      setItems(
        (po.items || []).map((it) => ({
          productId: it.productId,
          name: it.name,
          sku: it.sku,
          hsn: it.hsn,
          unit: it.unit || "PCS",
          rate: it.rate,
          orderedQty: it.quantity,
          receivedQty: it.quantity,
          acceptedQty: it.quantity,
          rejectedQty: 0,
          warehouseLocation: "Main Warehouse",
        }))
      );
    }
  };

  // Line Item Update
  const updateItem = (index: number, partial: Partial<PurchaseGrnItem>) => {
    setItems((prev) => {
      const next = [...prev];
      const merged = { ...next[index], ...partial };
      // Auto compute accepted / rejected
      if ("receivedQty" in partial || "rejectedQty" in partial) {
        const rec = partial.receivedQty !== undefined ? partial.receivedQty : merged.receivedQty;
        const rej = partial.rejectedQty !== undefined ? partial.rejectedQty : merged.rejectedQty;
        merged.acceptedQty = Math.max(0, rec - rej);
      }
      next[index] = merged;
      return next;
    });
  };

  const addItem = () => {
    const p = products[0];
    setItems((prev) => [
      ...prev,
      {
        productId: p?.id || "",
        name: p?.name || "Item",
        unit: p?.unit || "PCS",
        rate: p?.purchasePrice || 0,
        orderedQty: 0,
        receivedQty: 1,
        acceptedQty: 1,
        rejectedQty: 0,
        warehouseLocation: "Main Warehouse",
      },
    ]);
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) {
      toast.error("GRN must have at least 1 item");
      return;
    }
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  // Save GRN and update product current stock
  const handleSaveGrn = async () => {
    if (!supplierId) {
      toast.error("Please select a supplier");
      return;
    }
    if (items.length === 0) {
      toast.error("Please add at least 1 received item");
      return;
    }

    const sup = suppliers.find((s) => s.id === supplierId);
    const po = purchaseOrders.find((p) => p.id === poId);

    const grnPayload: PurchaseGrn = {
      id: editingGrn ? editingGrn.id : uid(),
      number: grnNumber,
      date: new Date(grnDate).getTime(),
      supplierId,
      supplierSnapshot: sup ? { id: sup.id, name: sup.name, gstin: sup.gstin, mobile: sup.mobile } : undefined,
      purchaseOrderId: poId || undefined,
      purchaseOrderNumber: po?.number,
      companyId: activeCompany?.id,
      branchId: activeBranchId && activeBranchId !== "all" ? activeBranchId : undefined,
      financialYearId: activeFinancialYear?.id,
      items,
      challanNumber,
      challanDate,
      transporter,
      vehicleNumber,
      notes,
      status: "received",
      createdAt: editingGrn ? editingGrn.createdAt : Date.now(),
      updatedAt: Date.now(),
    };

    // 1. Save GRN
    await db().purchaseGrns.put(grnPayload);

    // 2. Automatically update Product stock for accepted quantities
    for (const it of items) {
      if (it.productId && it.acceptedQty > 0) {
        const prod = await db().products.get(it.productId);
        if (prod) {
          const delta = editingGrn ? 0 : it.acceptedQty; // prevent double counting on edit
          if (delta > 0) {
            await db().products.update(it.productId, {
              currentStock: (prod.currentStock || 0) + delta,
            });
          }
        }
      }
    }

    // 3. Mark PO as received if fulfilled
    if (poId && po) {
      await db().purchaseOrders.update(poId, { status: "received" });
    }

    toast.success("Goods Receipt Note (GRN) created & inventory updated");
    setIsModalOpen(false);
  };

  // Delete GRN
  const handleDeleteGrn = async (id: string) => {
    if (confirm("Delete this Goods Receipt Note?")) {
      await db().purchaseGrns.delete(id);
      toast.success("GRN deleted");
    }
  };

  // Filtered GRNs
  const filteredGrns = useMemo(() => {
    return grns.filter((g) => {
      if (statusFilter !== "all" && g.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const matchesNum = g.number.toLowerCase().includes(q);
        const matchesSup = (g.supplierSnapshot?.name || "").toLowerCase().includes(q);
        const matchesChallan = (g.challanNumber || "").toLowerCase().includes(q);
        if (!matchesNum && !matchesSup && !matchesChallan) return false;
      }
      return true;
    });
  }, [grns, statusFilter, search]);

  // Export to Excel
  const exportToExcel = () => {
    const rows = filteredGrns.map((g) => ({
      "GRN Number": g.number,
      "Date": formatDate(g.date),
      "Supplier": g.supplierSnapshot?.name || "Supplier",
      "PO Number": g.purchaseOrderNumber || "Direct Inward",
      "Challan Number": g.challanNumber || "",
      "Vehicle Number": g.vehicleNumber || "",
      "Total Items": g.items?.length || 0,
      "Total Accepted Qty": g.items?.reduce((s, it) => s + (it.acceptedQty || 0), 0) || 0,
      "Total Rejected Qty": g.items?.reduce((s, it) => s + (it.rejectedQty || 0), 0) || 0,
      "Status": (g.status || "received").toUpperCase(),
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "GRN Register");
    XLSX.writeFile(wb, `GRN_Register_${new Date().toISOString().slice(0, 10)}.xlsx`);
    toast.success("GRN register exported to Excel");
  };

  // Print PDF for GRN
  const printGrnPDF = async (grn: PurchaseGrn) => {
    const comp = await getCompany(activeCompany?.id);
    const doc = new jsPDF();

    // Header
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.text(comp.name || "Business Enterprise", 14, 18);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    if (comp.address) doc.text(comp.address, 14, 24);

    // Title Badge
    doc.setFillColor(16, 185, 129);
    doc.roundedRect(130, 12, 66, 12, 2, 2, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("GOODS RECEIPT NOTE", 133, 20);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(`GRN No: ${grn.number}`, 130, 30);
    doc.text(`Date: ${formatDate(grn.date)}`, 130, 35);
    if (grn.purchaseOrderNumber) doc.text(`PO Ref: ${grn.purchaseOrderNumber}`, 130, 40);

    // Vendor & Inward info
    doc.setDrawColor(200, 200, 200);
    doc.roundedRect(14, 45, 182, 22, 2, 2, "S");
    doc.setFont("helvetica", "bold");
    doc.text("SUPPLIER / CARRIER DETAILS:", 18, 51);
    doc.setFont("helvetica", "normal");
    doc.text(`Supplier: ${grn.supplierSnapshot?.name || "Supplier"}`, 18, 57);
    if (grn.challanNumber) doc.text(`Delivery Challan #: ${grn.challanNumber}`, 18, 62);
    if (grn.transporter) doc.text(`Transporter: ${grn.transporter}`, 110, 57);
    if (grn.vehicleNumber) doc.text(`Vehicle No: ${grn.vehicleNumber}`, 110, 62);

    // Items Table
    const tableData = (grn.items || []).map((it, idx) => [
      idx + 1,
      it.name,
      `${it.orderedQty || 0} ${it.unit}`,
      `${it.receivedQty || 0} ${it.unit}`,
      `${it.acceptedQty || 0} ${it.unit}`,
      `${it.rejectedQty || 0} ${it.unit}`,
      it.rejectionReason || "—",
      it.warehouseLocation || "Main",
    ]);

    autoTable(doc, {
      startY: 72,
      head: [["#", "Item Description", "Ordered", "Received", "Accepted", "Rejected", "Reason", "Location"]],
      body: tableData,
      theme: "grid",
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontSize: 8 },
      bodyStyles: { fontSize: 8 },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 12;
    doc.setFont("helvetica", "bold");
    doc.text("Received By (Store In-charge): ____________________", 14, finalY);
    doc.text("Inspected By (QC Manager): ____________________", 110, finalY);

    doc.save(`${grn.number}.pdf`);
    toast.success(`PDF downloaded for ${grn.number}`);
  };

  return (
    <div className="space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Total Inwards</span>
            <Truck className="h-4 w-4 text-primary" />
          </div>
          <div className="mt-1 text-xl font-bold">{grns.length}</div>
          <div className="text-[10px] text-muted-foreground">Goods Receipt Notes</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Accepted Qty</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-400">
            {grns.reduce((sum, g) => sum + (g.items?.reduce((s, it) => s + (it.acceptedQty || 0), 0) || 0), 0)}
          </div>
          <div className="text-[10px] text-muted-foreground">Added to physical stock</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Rejected Qty</span>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-400">
            {grns.reduce((sum, g) => sum + (g.items?.reduce((s, it) => s + (it.rejectedQty || 0), 0) || 0), 0)}
          </div>
          <div className="text-[10px] text-muted-foreground">Damaged / non-compliant</div>
        </Card>

        <Card className="p-3.5 card-soft">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Active Carriers</span>
            <PackageCheck className="h-4 w-4 text-blue-600" />
          </div>
          <div className="mt-1 text-xl font-bold text-foreground">
            {new Set(grns.map((g) => g.transporter).filter(Boolean)).size || 1}
          </div>
          <div className="text-[10px] text-muted-foreground">Logistics partners</div>
        </Card>
      </div>

      {/* Toolbar */}
      <Card className="p-3 card-soft">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search GRN #, supplier, challan..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportToExcel} className="gap-1.5 text-xs h-9">
              <Download className="h-3.5 w-3.5" />
              <span>Excel Export</span>
            </Button>
            <Button size="sm" onClick={() => openNewGrn()} className="gap-1.5 text-xs h-9">
              <Plus className="h-3.5 w-3.5" />
              <span>New GRN (Inward)</span>
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
                <TableHead>GRN Number</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>PO Reference</TableHead>
                <TableHead>Challan #</TableHead>
                <TableHead className="text-right">Accepted Qty</TableHead>
                <TableHead className="text-right">Rejected Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right w-36">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredGrns.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">
                    No Goods Receipt Notes found. Click &quot;New GRN (Inward)&quot; to record delivery.
                  </TableCell>
                </TableRow>
              ) : (
                filteredGrns.map((g) => {
                  const accQty = g.items?.reduce((s, it) => s + (it.acceptedQty || 0), 0) || 0;
                  const rejQty = g.items?.reduce((s, it) => s + (it.rejectedQty || 0), 0) || 0;

                  return (
                    <TableRow key={g.id} className="text-xs hover:bg-secondary/20">
                      <TableCell className="font-mono font-bold text-emerald-600">{g.number}</TableCell>
                      <TableCell>{formatDate(g.date)}</TableCell>
                      <TableCell>
                        <div className="font-medium text-foreground">{g.supplierSnapshot?.name || "Supplier"}</div>
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{g.purchaseOrderNumber || "Direct Inward"}</TableCell>
                      <TableCell className="font-mono">{g.challanNumber || "—"}</TableCell>
                      <TableCell className="text-right font-mono font-bold text-emerald-600">{accQty}</TableCell>
                      <TableCell className="text-right font-mono text-rose-600">{rejQty > 0 ? rejQty : "0"}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 text-[10px]">
                          {g.status || "received"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-emerald-600 hover:bg-emerald-500/10"
                            title="Print GRN PDF"
                            onClick={() => printGrnPDF(g)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            title="Edit GRN"
                            onClick={() => openEditGrn(g)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            title="Delete GRN"
                            onClick={() => handleDeleteGrn(g.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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

      {/* Create / Edit GRN Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="text-base font-bold">
              {editingGrn ? `Edit Goods Receipt Note (${editingGrn.number})` : "Create Goods Receipt Note (GRN)"}
            </DialogTitle>
          </DialogHeader>

          <div className="p-4 overflow-y-auto flex-1 space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">GRN Number *</Label>
                <Input value={grnNumber} onChange={(e) => setGrnNumber(e.target.value)} className="text-xs h-8 font-mono uppercase" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Receipt Date *</Label>
                <Input type="date" value={grnDate} onChange={(e) => setGrnDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Link Purchase Order</Label>
                <Select value={poId} onValueChange={handleSelectPo}>
                  <SelectTrigger className="text-xs h-8">
                    <SelectValue placeholder="Direct (No PO)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="" className="text-xs">Direct (No PO)</SelectItem>
                    {purchaseOrders.map((p) => (
                      <SelectItem key={p.id} value={p.id} className="text-xs">
                        {p.number} — {p.supplierSnapshot?.name || "Supplier"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Challan / Bill Number</Label>
                <Input value={challanNumber} onChange={(e) => setChallanNumber(e.target.value)} placeholder="e.g. DC-987" className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Challan Date</Label>
                <Input type="date" value={challanDate} onChange={(e) => setChallanDate(e.target.value)} className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Transporter Name</Label>
                <Input value={transporter} onChange={(e) => setTransporter(e.target.value)} placeholder="e.g. VRL Logistics" className="text-xs h-8" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Vehicle Number</Label>
                <Input value={vehicleNumber} onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())} placeholder="e.g. MH-12-AB-1234" className="text-xs h-8 uppercase font-mono" />
              </div>
            </div>

            {/* Inward Items Table */}
            <div className="space-y-2 pt-2 border-t border-border/70">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Inward Inspection & Count</Label>
                <Button size="sm" variant="outline" onClick={addItem} className="gap-1 text-xs h-7">
                  <Plus className="h-3 w-3" /> Add Item
                </Button>
              </div>

              <div className="border border-border/70 rounded-lg overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-secondary/40 text-[10px] uppercase font-semibold text-muted-foreground">
                      <TableHead className="w-10">#</TableHead>
                      <TableHead className="w-64">Item Description</TableHead>
                      <TableHead className="w-20 text-right">Ordered</TableHead>
                      <TableHead className="w-20 text-right">Received</TableHead>
                      <TableHead className="w-20 text-right">Accepted</TableHead>
                      <TableHead className="w-20 text-right">Rejected</TableHead>
                      <TableHead className="w-32">Rejection Reason</TableHead>
                      <TableHead className="w-32">Location / Rack</TableHead>
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
                            onValueChange={(val) => {
                              const prod = products.find((p) => p.id === val);
                              updateItem(idx, {
                                productId: val,
                                name: prod?.name || it.name,
                                unit: prod?.unit || it.unit,
                              });
                            }}
                          >
                            <SelectTrigger className="text-xs h-7">
                              <SelectValue placeholder="Select Product" />
                            </SelectTrigger>
                            <SelectContent className="max-h-56">
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id} className="text-xs">
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={it.orderedQty}
                            onChange={(e) => updateItem(idx, { orderedQty: parseFloat(e.target.value) || 0 })}
                            className="text-xs h-7 text-right font-mono"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={it.receivedQty}
                            onChange={(e) => updateItem(idx, { receivedQty: parseFloat(e.target.value) || 0 })}
                            className="text-xs h-7 text-right font-mono font-semibold"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={it.acceptedQty}
                            readOnly
                            className="text-xs h-7 text-right font-mono text-emerald-700 bg-emerald-500/10 font-bold"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            value={it.rejectedQty}
                            onChange={(e) => updateItem(idx, { rejectedQty: parseFloat(e.target.value) || 0 })}
                            className="text-xs h-7 text-right font-mono text-rose-700 font-semibold"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.rejectionReason || ""}
                            onChange={(e) => updateItem(idx, { rejectionReason: e.target.value })}
                            placeholder="e.g. Dent, rust"
                            className="text-xs h-7"
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={it.warehouseLocation || ""}
                            onChange={(e) => updateItem(idx, { warehouseLocation: e.target.value })}
                            placeholder="Rack A-1"
                            className="text-xs h-7 font-mono"
                          />
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

            <div className="space-y-1">
              <Label className="text-xs">Inspection Remarks / Notes</Label>
              <Input
                placeholder="e.g. Packages verified intact upon arrival"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="text-xs h-8"
              />
            </div>
          </div>

          <DialogFooter className="p-3 border-t gap-2 sm:gap-0">
            <Button variant="ghost" size="sm" onClick={() => setIsModalOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveGrn} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {editingGrn ? "Update GRN" : "Record Receipt & Update Stock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
