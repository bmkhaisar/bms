import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LineItemsEditor } from "./LineItemsEditor";
import { computeLine, computeTotals, applyStockDelta } from "@/lib/calc";
import type { Customer, Supplier, LineItem, Invoice, Quotation, Purchase, CompanySettings } from "@/lib/db";
import { db, nextNumber, uid, getCompany } from "@/lib/db";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/useLive";
import { toDateInput, fromDateInput, formatDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "./ConfirmDialog";
import { Copy, Download, FileText, Pencil, Plus, Printer, Trash2 } from "lucide-react";
import { ListToolbar, EmptyState, usePagination, Pager } from "./ListHelpers";
import { DocumentPrint, type DocumentKind } from "./DocumentPrint";
import { printElement } from "@/lib/pdf";
import { downloadDocumentPDF, type NormalizedDocument } from "@/lib/documentRenderer";
import { ListSkeleton } from "./Skeletons";
import { useInitialLoading } from "@/lib/useInitialLoading";
import { convertQuotationToInvoice as doConvertQuotation } from "@/modules/documents/quotationConversion";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { postInvoiceTransaction, postPurchaseTransaction, amendPostedInvoiceTransaction } from "@/modules/accounting/services/documentPostingService";
import { ensureCustomerLedger, ensureSupplierLedger } from "@/modules/accounting/services/partyLedgerSyncService";

type AnyDoc = Invoice | Quotation | Purchase;

export function DocumentListPage<T extends AnyDoc>({
  kind, title, addLabel, tableFor,
}: {
  kind: "invoice" | "quotation" | "purchase";
  title: string;
  addLabel: string;
  tableFor: "customer" | "supplier";
}) {
  const rows = useLive<T>(async () => {
    const table = kind === "invoice" ? db().invoices : kind === "quotation" ? db().quotations : db().purchases;
    return (await table.orderBy("createdAt").reverse().toArray()) as unknown as T[];
  });
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const suppliers = useLive<Supplier>(() => db().suppliers.orderBy("name").toArray());
  const quotations = useLive<Quotation>(() => kind === "invoice" ? db().quotations.orderBy("createdAt").reverse().toArray() : Promise.resolve([]));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  useEffect(() => { getCompany().then(setCompany); }, []);
  const initialLoading = useInitialLoading();

  // Deep-link support: auto-filter and open preview if target id or q is present in URL
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    const idParam = params.get("id");
    if (queryParam) {
      setQ(queryParam);
    }
    if (idParam && rows.length > 0) {
      const match = rows.find((r) => r.id === idParam || (r as AnyDoc).number === idParam);
      if (match) {
        setPreview(match);
      }
    }
  }, [rows]);

  const parties = tableFor === "customer" ? customers : suppliers;
  const partyById = (id: string) => parties.find(p => p.id === id);
  const filtered = rows.filter(r => {
    if (!q) return true;
    const s = q.toLowerCase();
    const p = partyById((r as any).customerId ?? (r as Purchase).supplierId);
    return (r as AnyDoc).number.toLowerCase().includes(s) || (p?.name.toLowerCase().includes(s) ?? false);
  });
  const pager = usePagination(filtered, 12);

  const { user } = useAuth();
  const { activeCompany, activeFinancialYear } = useActiveCompany();

  async function openNew() {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const customPrefix =
      kind === "invoice"
        ? activeCompany?.invoicePrefix
        : kind === "quotation"
        ? activeCompany?.quotationPrefix
        : activeCompany?.purchasePrefix;

    const number = await getNextDocumentNumber({
      kind,
      companyId: activeCompany?.id,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      idToken,
      customPrefix,
    });

    const base = {
      id: uid(), number, date: Date.now(), items: [] as LineItem[],
      subtotal: 0, discountTotal: 0, gstTotal: 0, roundOff: 0, grandTotal: 0,
      createdAt: Date.now(),
    };
    if (kind === "invoice") {
      setEditing({ ...base, customerId: "", cgstTotal: 0, sgstTotal: 0, igstTotal: 0, isIgst: false, amountPaid: 0, balance: 0, status: "unpaid" } as unknown as T);
    } else if (kind === "quotation") {
      setEditing({ ...base, customerId: "", status: "draft" } as unknown as T);
    } else {
      setEditing({ ...base, supplierId: "", amountPaid: 0, balance: 0, status: "unpaid" } as unknown as T);
    }
    setOpen(true);
  }

  function openEdit(r: T) { setEditing({ ...r }); setOpen(true); }

  async function save() {
    if (!editing) return;
    const partyId = (editing as any).customerId ?? (editing as Purchase).supplierId;
    if (!partyId) { toast.error(`Select a ${tableFor}`); return; }
    if (!editing.items.length) { toast.error("Add at least one item"); return; }

    const isIgst = kind === "invoice" && (editing as unknown as Invoice).isIgst;
    const totals = computeTotals(editing.items, isIgst);
    const party = partyById(partyId);
    const patched = {
      ...(editing as AnyDoc),
      ...totals,
      ...(tableFor === "customer" ? { customerSnapshot: party as Customer | undefined } : { supplierSnapshot: party as Supplier | undefined }),
    } as AnyDoc;

    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}

    if (kind === "invoice") {
      const inv = patched as Invoice;
      inv.balance = Math.max(0, inv.grandTotal - inv.amountPaid);
      inv.status = inv.balance <= 0.01 ? "paid" : inv.amountPaid > 0 ? "partial" : "unpaid";

      const prev = await db().invoices.get(inv.id);
      if (prev) await applyStockDelta(prev.items, 1); // revert old
      await applyStockDelta(inv.items, -1);

      if (activeCompany?.id && activeFinancialYear?.id && user) {
        const custLedger = await ensureCustomerLedger({
          companyId: activeCompany.id,
          customer: party as Customer,
          uid: user.uid,
        });

        if (prev && prev.postingStatus === "posted") {
          const res = await amendPostedInvoiceTransaction({
            companyId: activeCompany.id,
            financialYearId: activeFinancialYear.id,
            originalInvoice: prev,
            correctedInvoice: inv,
            company: activeCompany,
            customerLedgerId: custLedger.ledgerId,
            idToken,
            uid: user.uid,
            amendmentReason: "Invoice edit and amendment",
          });
          if (!res.success) {
            toast.error(`Amendment failed: ${res.error}`);
            return;
          }
        } else {
          const res = await postInvoiceTransaction({
            companyId: activeCompany.id,
            financialYearId: activeFinancialYear.id,
            invoice: inv,
            company: activeCompany,
            customerLedgerId: custLedger.ledgerId,
            idToken,
            uid: user.uid,
          });
          if (!res.success) {
            toast.error(`Posting failed: ${res.error}`);
            return;
          }
        }
      } else {
        await db().invoices.put(inv);
      }
    } else if (kind === "purchase") {
      const pu = patched as Purchase;
      pu.balance = Math.max(0, pu.grandTotal - pu.amountPaid);
      pu.status = pu.balance <= 0.01 ? "paid" : pu.amountPaid > 0 ? "partial" : "unpaid";

      const prev = await db().purchases.get(pu.id);
      if (prev) await applyStockDelta(prev.items, -1); // revert old
      await applyStockDelta(pu.items, 1);

      if (activeCompany?.id && activeFinancialYear?.id && user) {
        const suppLedger = await ensureSupplierLedger({
          companyId: activeCompany.id,
          supplier: party as Supplier,
          uid: user.uid,
        });

        const res = await postPurchaseTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          purchase: pu,
          company: activeCompany,
          supplierLedgerId: suppLedger.ledgerId,
          idToken,
          uid: user.uid,
        });
        if (!res.success) {
          toast.error(`Posting failed: ${res.error}`);
          return;
        }
      } else {
        await db().purchases.put(pu);
      }
    } else {
      await db().quotations.put(patched as Quotation);
    }

    toast.success("Saved");
    setOpen(false);
    setEditing(null);
  }

  async function remove(id: string) {
    if (kind === "invoice") {
      const prev = await db().invoices.get(id);
      if (prev) await applyStockDelta(prev.items, 1);
      await db().invoices.delete(id);
    } else if (kind === "purchase") {
      const prev = await db().purchases.get(id);
      if (prev) await applyStockDelta(prev.items, -1);
      await db().purchases.delete(id);
    } else {
      await db().quotations.delete(id);
    }
    toast.success("Deleted");
  }

  async function duplicate(r: T) {
    const number = await nextNumber(kind);
    const dup = { ...r, id: uid(), number, createdAt: Date.now(), date: Date.now() } as T;
    if (kind === "invoice") { (dup as unknown as Invoice).amountPaid = 0; (dup as unknown as Invoice).balance = (dup as unknown as Invoice).grandTotal; (dup as unknown as Invoice).status = "unpaid"; }
    if (kind === "purchase") { (dup as unknown as Purchase).amountPaid = 0; (dup as unknown as Purchase).balance = (dup as unknown as Purchase).grandTotal; (dup as unknown as Purchase).status = "unpaid"; }
    setEditing(dup); setOpen(true);
  }

  async function convertQuotationToInvoice(q: Quotation) {
    await doConvertQuotation(q);
  }

  function applyQuotationToInvoice(id: string) {
    if (!editing || kind !== "invoice") return;
    const quote = quotations.find(item => item.id === id);
    if (!quote) return;
    const inv = editing as unknown as Invoice;
    const items = quote.items.map(item => computeLine({ ...item }));
    const totals = computeTotals(items, inv.isIgst);
    const amountPaid = Number(inv.amountPaid) || 0;
    const extraCharges = quote.extraCharges ? [...quote.extraCharges] : [];
    const extraChargesTotal = extraCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0);
    const finalGrandTotal = totals.grandTotal + extraChargesTotal;
    setEditing({
      ...editing,
      customerId: quote.customerId,
      customerSnapshot: quote.customerSnapshot,
      items,
      subtotal: totals.subtotal,
      discountTotal: totals.discountTotal,
      gstTotal: totals.gstTotal,
      cgstTotal: totals.cgstTotal,
      sgstTotal: totals.sgstTotal,
      igstTotal: totals.igstTotal,
      extraCharges,
      extraChargesTotal,
      roundOff: totals.roundOff,
      grandTotal: finalGrandTotal,
      amountPaid,
      balance: Math.max(0, finalGrandTotal - amountPaid),
      notes: quote.notes,
      terms: quote.terms,
      convertedFromQuotationId: quote.id,
    } as T);
    toast.success(`Loaded quotation ${quote.number}`);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 animate-fade-in">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">{title}</h2>
          <p className="text-sm text-muted-foreground">Create, edit, print and export {title.toLowerCase()}.</p>
        </div>
        <Button className="gap-2 hover-scale" onClick={openNew}><Plus className="h-4 w-4" /> {addLabel}</Button>
      </div>

      {initialLoading ? (
        <ListSkeleton columns={kind === "quotation" ? 6 : 7} />
      ) : (
        <div className="animate-fade-in">
          <ListToolbar query={q} onQuery={setQ} placeholder="Search by number or party…" />

          {rows.length === 0 ? (
            <EmptyState title={`No ${title.toLowerCase()} yet`} action={<Button className="mt-2 gap-2" onClick={openNew}><Plus className="h-4 w-4" /> {addLabel}</Button>} />
          ) : (
            <Card className="card-soft overflow-hidden">
              <div className="overflow-x-auto scrollbar-hidden">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Number</TableHead><TableHead>Date</TableHead>
                    <TableHead>{tableFor === "customer" ? "Customer" : "Supplier"}</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    {kind !== "quotation" && <TableHead className="text-right">Balance</TableHead>}
                    <TableHead>Status</TableHead>
                    <TableHead className="w-48 text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pager.items.map(r => {
                      const p = partyById((r as any).customerId ?? (r as Purchase).supplierId);
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono">{r.number}</TableCell>
                          <TableCell>{formatDate(r.date)}</TableCell>
                          <TableCell>{p?.name ?? "—"}</TableCell>
                          <TableCell className="text-right font-mono">{formatMoney(r.grandTotal)}</TableCell>
                          {kind !== "quotation" && <TableCell className="text-right font-mono">{formatMoney((r as unknown as Invoice).balance)}</TableCell>}
                          <TableCell><span className="rounded-md bg-muted px-2 py-0.5 text-xs uppercase">{(r as unknown as Invoice).status}</span></TableCell>
                          <TableCell className="text-right">
                            <Button size="icon" variant="ghost" title="View / Print" onClick={() => setPreview(r)}><Printer className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" title="Duplicate" onClick={() => duplicate(r)}><Copy className="h-4 w-4" /></Button>
                            {kind === "quotation" && <Button size="icon" variant="ghost" title="Convert to invoice" onClick={() => convertQuotationToInvoice(r as unknown as Quotation)}><FileText className="h-4 w-4" /></Button>}
                            <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
          <Pager {...pager} />
        </div>
      )}


      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="flex h-[min(95dvh,820px)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden gap-0 p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6"><DialogTitle>{editing && rows.find(r => r.id === editing.id) ? `Edit ${title.slice(0, -1).toLowerCase()}` : `New ${title.slice(0, -1).toLowerCase()}`}</DialogTitle></DialogHeader>
          {editing && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hidden px-3 py-4 sm:px-6">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1.5"><Label className="text-xs">Number</Label><Input value={editing.number} readOnly className="font-mono" /></div>
                <div className="space-y-1.5"><Label className="text-xs">Date</Label><Input type="date" value={toDateInput(editing.date)} onChange={e => setEditing({ ...editing, date: fromDateInput(e.target.value) })} /></div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{tableFor === "customer" ? "Customer *" : "Supplier *"}</Label>
                  <Select value={((editing as any).customerId ?? (editing as Purchase).supplierId) || ""} onValueChange={v => setEditing({ ...editing, ...(tableFor === "customer" ? { customerId: v } : { supplierId: v }) } as T)}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>{parties.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {kind === "invoice" && (
                  <>
                    <div className="space-y-1.5 sm:col-span-3">
                      <Label className="text-xs">Load from quotation</Label>
                      <Select onValueChange={applyQuotationToInvoice}>
                        <SelectTrigger><SelectValue placeholder="Select a quotation to copy customer and items…" /></SelectTrigger>
                        <SelectContent>
                          {quotations.length === 0 && <SelectItem value="__none__" disabled>No quotations saved</SelectItem>}
                          {quotations.map(item => (
                            <SelectItem key={item.id} value={item.id}>{item.number} · {partyById(item.customerId)?.name ?? item.customerSnapshot?.name ?? "Customer"} · {formatMoney(item.grandTotal)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs">Due date</Label><Input type="date" value={toDateInput((editing as unknown as Invoice).dueDate)} onChange={e => setEditing({ ...editing, dueDate: fromDateInput(e.target.value) } as T)} /></div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Tax Type</Label>
                      <Select value={(editing as unknown as Invoice).isIgst ? "igst" : "cgst"} onValueChange={v => setEditing({ ...editing, isIgst: v === "igst" } as T)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cgst">CGST + SGST (Intra-state)</SelectItem>
                          <SelectItem value="igst">IGST (Inter-state)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5"><Label className="text-xs">Amount Paid</Label><Input type="number" step="0.01" value={(editing as unknown as Invoice).amountPaid} onChange={e => setEditing({ ...editing, amountPaid: Number(e.target.value) } as T)} /></div>
                  </>
                )}
                {kind === "purchase" && (
                  <div className="space-y-1.5"><Label className="text-xs">Amount Paid</Label><Input type="number" step="0.01" value={(editing as unknown as Purchase).amountPaid} onChange={e => setEditing({ ...editing, amountPaid: Number(e.target.value) } as T)} /></div>
                )}
              </div>

              <LineItemsEditor
                items={editing.items}
                onChange={(items) => setEditing({ ...editing, items } as T)}
                mode={kind === "purchase" ? "purchase" : "sales"}
                isIgst={kind === "invoice" ? (editing as unknown as Invoice).isIgst : false}
              />

              {kind === "invoice" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label className="text-xs">Billing address</Label><Textarea rows={2} value={(editing as unknown as Invoice).billingAddress ?? ""} onChange={e => setEditing({ ...editing, billingAddress: e.target.value } as T)} /></div>
                  <div className="space-y-1.5"><Label className="text-xs">Shipping address</Label><Textarea rows={2} value={(editing as unknown as Invoice).shippingAddress ?? ""} onChange={e => setEditing({ ...editing, shippingAddress: e.target.value } as T)} /></div>
                </div>
              )}
              <div className="space-y-1.5"><Label className="text-xs">Notes</Label><Textarea rows={2} value={(editing as AnyDoc).notes ?? ""} onChange={e => setEditing({ ...editing, notes: e.target.value } as T)} /></div>
            </div>
          )}
          <DialogFooter className="shrink-0 gap-2 border-t bg-background px-3 py-3 sm:px-6">
            <Button variant="ghost" onClick={() => setOpen(false)} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={save} className="w-full sm:w-auto">Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview / Print / PDF */}
      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>Preview · {preview?.number}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-2" onClick={() => printElement("print-doc")}><Printer className="h-4 w-4" /> Print</Button>
                <Button
                  size="sm"
                  className="gap-2"
                  onClick={() => {
                    if (!preview) return;
                    const isInv = kind === "invoice";
                    const party = partyById((preview as any).customerId ?? (preview as Purchase).supplierId) || { name: "Client" };
                    const normDoc: NormalizedDocument = {
                      kind: kind as any,
                      title: kind === "invoice" ? "Tax Invoice" : kind === "quotation" ? "Quotation" : "Purchase Bill",
                      number: preview.number,
                      date: preview.date,
                      dueDate: (preview as Invoice).dueDate,
                      company: (preview as any).companySnapshot || company || {},
                      party: {
                        name: party.name,
                        company: party.company,
                        address: party.address,
                        city: (party as any).city,
                        state: (party as any).state,
                        pincode: (party as any).pincode,
                        gstin: party.gstin,
                        phone: (party as any).mobile,
                        email: party.email,
                      },
                      items: preview.items,
                      subtotal: preview.subtotal,
                      discountTotal: preview.discountTotal,
                      cgstTotal: (preview as Invoice).cgstTotal,
                      sgstTotal: (preview as Invoice).sgstTotal,
                      igstTotal: (preview as Invoice).igstTotal,
                      gstTotal: preview.gstTotal,
                      extraCharges: (preview as Invoice).extraCharges,
                      extraChargesTotal: (preview as Invoice).extraChargesTotal,
                      roundOff: preview.roundOff,
                      grandTotal: preview.grandTotal,
                      amountPaid: (preview as Invoice).amountPaid,
                      balance: (preview as Invoice).balance,
                      notes: preview.notes,
                      terms: preview.terms,
                    };
                    downloadDocumentPDF(normDoc, `${preview.number}.pdf`);
                    toast.success(`Vector PDF downloaded: ${preview.number}.pdf`);
                  }}
                >
                  <Download className="h-4 w-4" /> Vector PDF
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          {preview && company && (
            <div className="max-h-[75vh] overflow-auto scrollbar-hidden bg-muted p-4">
              <DocumentPrint company={company} kind={kind as DocumentKind} doc={preview as unknown as Invoice} party={partyById((preview as any).customerId ?? (preview as Purchase).supplierId)} />
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)} title={`Delete this ${title.slice(0, -1).toLowerCase()}?`} description="This cannot be undone. Stock movements will be reversed." destructive confirmText="Delete" onConfirm={async () => { if (deleteId) await remove(deleteId); }} />
    </>
  );
}
