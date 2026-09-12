import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Copy, Download, FileText, Pencil, Plus, Printer, Trash2, FileType2, Share2, FileCheck,
} from "lucide-react";
import {
  db, uid, nextNumber, getCompany,
  type Quotation, type Customer, type CompanySettings, type QuotationTemplate,
} from "@/lib/db";
import { convertQuotationToInvoice } from "@/modules/documents/quotationConversion";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { downloadQuotationPDF, downloadQuotationDOCX, exportQuotationPDF } from "@/lib/quotationExport";
import { QuotationForm } from "./QuotationForm";
import { ListToolbar, EmptyState, usePagination, Pager } from "./ListHelpers";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSkeleton } from "./Skeletons";
import { useInitialLoading } from "@/lib/useInitialLoading";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, onValue } from "firebase/database";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { createCompanySnapshot } from "@/modules/company/types";
import { createSignatorySnapshot } from "@/modules/company/signatoryHelper";

export function QuotationsPage() {
  const rows = useLive<Quotation>(() => db().quotations.orderBy("createdAt").reverse().toArray());
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const templates = useLive<QuotationTemplate>(() => db().quotationTemplates.orderBy("name").toArray());
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<"new" | "old" | "amount" | "number">("new");
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const initialLoading = useInitialLoading();

  const { user } = useAuth();
  const { activeCompany, activeFinancialYear } = useActiveCompany();

  useEffect(() => { getCompany().then(setCompany); }, []);

  // Realtime Cloud Synchronization with Firebase RTDB and local Dexie indexing
  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) return;
    const qRef = ref(firebaseDb, `companyData/${activeCompany.id}/quotations`);
    const unsub = onValue(qRef, async (snap) => {
      if (snap.exists()) {
        const val = snap.val();
        const serverQuotes = Object.values(val) as Quotation[];
        for (const quote of serverQuotes) {
          if (quote && quote.id) {
            await db().quotations.put(quote);
            await cacheEntity({
              uid: user?.uid || "",
              companyId: activeCompany.id,
              entityType: "quotations",
              entityId: quote.id,
              data: quote,
              financialYearId: activeFinancialYear?.id,
              name: quote.number,
            });
          }
        }
      }
    });
    return () => unsub();
  }, [activeCompany?.id, activeFinancialYear?.id, user?.uid]);

  // Deep-link support: auto-filter and open quotation editor/preview
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    const idParam = params.get("id");
    if (queryParam) setQ(queryParam);
    if (idParam && rows.length > 0) {
      const match = rows.find((r) => r.id === idParam || r.number === idParam);
      if (match) setEditing(match);
    }
  }, [rows]);

  const cust = (id: string) => customers.find(c => c.id === id);
  const tpl = (id?: string) => templates.find(t => t.id === id) || templates.find(t => t.isDefault);

  let filtered = rows.filter(r => {
    if (status !== "all" && r.status !== status) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return r.number.toLowerCase().includes(s) || (cust(r.customerId)?.name.toLowerCase().includes(s) ?? false);
  });
  filtered = [...filtered].sort((a, b) => {
    if (sort === "new") return b.createdAt - a.createdAt;
    if (sort === "old") return a.createdAt - b.createdAt;
    if (sort === "amount") return b.grandTotal - a.grandTotal;
    return a.number.localeCompare(b.number);
  });
  const pager = usePagination(filtered, 12);

  async function openNew() {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const number = await getNextDocumentNumber({
      kind: "quotation",
      companyId: activeCompany?.id,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      idToken,
      customPrefix: activeCompany?.quotationPrefix,
    });
    setEditing({
      id: uid(), number, date: Date.now(), customerId: "",
      items: [], subtotal: 0, discountTotal: 0, gstTotal: 0, roundOff: 0, grandTotal: 0,
      status: "draft", createdAt: Date.now(), extraCharges: [],
    });
  }
  async function duplicate(r: Quotation) {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const number = await getNextDocumentNumber({
      kind: "quotation",
      companyId: activeCompany?.id,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      idToken,
      customPrefix: activeCompany?.quotationPrefix,
    });
    setEditing({ ...r, id: uid(), number, createdAt: Date.now(), date: Date.now(), status: "draft" });
  }
  async function saveQuotation(next: Quotation) {
    const comp = activeCompany || company;
    const toSave: Quotation = {
      ...next,
      companySnapshot:
        next.status !== "draft"
          ? next.companySnapshot || (comp ? createCompanySnapshot(comp as any) : undefined)
          : next.companySnapshot,
      signatorySnapshot:
        next.status !== "draft"
          ? next.signatorySnapshot ||
            (comp ? createSignatorySnapshot(comp as any, next.signatoryOverride, next.date) : undefined)
          : next.signatorySnapshot,
    };
    await db().quotations.put(toSave);
    if (activeCompany?.id && firebaseDb) {
      try {
        const qRef = ref(firebaseDb, `companyData/${activeCompany.id}/quotations/${toSave.id}`);
        await set(qRef, sanitizeForFirebase({
          ...toSave,
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear?.id,
          updatedAt: Date.now(),
        }));
        await cacheEntity({
          uid: user?.uid || "",
          companyId: activeCompany.id,
          entityType: "quotations",
          entityId: toSave.id,
          data: toSave,
          financialYearId: activeFinancialYear?.id,
          name: toSave.number,
        });
      } catch (e) {
        console.warn("Quotation RTDB sync error:", e);
      }
    }
    toast.success("Quotation saved");
    setEditing(null);
  }
  async function remove(id: string) {
    await db().quotations.delete(id);
    if (activeCompany?.id && firebaseDb) {
      try {
        const qRef = ref(firebaseDb, `companyData/${activeCompany.id}/quotations/${id}`);
        await set(qRef, null);
      } catch (e) {
        console.warn("Quotation RTDB delete error:", e);
      }
    }
    toast.success("Deleted");
  }

  async function handleConvert(r: Quotation) {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    await convertQuotationToInvoice(r, {
      activeCompany,
      financialYearId: activeFinancialYear?.id,
      fyName: activeFinancialYear?.name,
      user,
      idToken,
      companySettings: company,
    });
  }

  async function exportPDF(r: Quotation) {
    if (!company) return;
    await downloadQuotationPDF(r, company, cust(r.customerId), tpl(r.templateId));
    toast.success(`Downloaded ${r.number}.pdf`);
  }
  async function exportDOCX(r: Quotation) {
    if (!company) return;
    await downloadQuotationDOCX(r, company, cust(r.customerId));
    toast.success(`Downloaded ${r.number}.docx`);
  }
  async function printQuote(r: Quotation) {
    if (!company) return;
    const blob = await exportQuotationPDF(r, company, cust(r.customerId), tpl(r.templateId));
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 800);
  }
  async function share(r: Quotation) {
    if (!company) return;
    const blob = await exportQuotationPDF(r, company, cust(r.customerId), tpl(r.templateId));
    const file = new File([blob], `${r.number}.pdf`, { type: "application/pdf" });
    const nav = navigator as any;
    if (nav.canShare?.({ files: [file] })) {
      try { await nav.share({ files: [file], title: r.number, text: `Quotation ${r.number}` }); return; } catch { /* ignore */ }
    }
    exportPDF(r);
    toast.info("Web Share unavailable — downloaded PDF instead");
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 animate-fade-in">
        <div>
          <h2 className="text-xl font-semibold sm:text-2xl">Quotations</h2>
          <p className="text-sm text-muted-foreground">Create premium multi-page quotations with PDF & DOCX export.</p>
        </div>
        <Button className="gap-2 hover-scale" onClick={openNew}><Plus className="h-4 w-4" /> New quotation</Button>
      </div>

      {initialLoading ? (
        <ListSkeleton columns={6} />
      ) : (
        <div className="animate-fade-in">
          <ListToolbar
            query={q} onQuery={setQ} placeholder="Search by number or customer…"
            right={
              <>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={sort} onValueChange={v => setSort(v as any)}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="new">Newest first</SelectItem>
                    <SelectItem value="old">Oldest first</SelectItem>
                    <SelectItem value="amount">Highest amount</SelectItem>
                    <SelectItem value="number">By number</SelectItem>
                  </SelectContent>
                </Select>
              </>
            }
          />

          {rows.length === 0 ? (
            <EmptyState
              title="No quotations yet"
              description="Create your first quotation. Add products, sizes, extra charges, and download a premium PDF or DOCX."
              action={<Button className="mt-2 gap-2" onClick={openNew}><Plus className="h-4 w-4" /> New quotation</Button>}
            />
          ) : (
            <Card className="card-soft overflow-hidden">
              <div className="overflow-x-auto scrollbar-hidden">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>Number</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-64 text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pager.items.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono">{r.number}</TableCell>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell>{cust(r.customerId)?.name || "—"}</TableCell>
                        <TableCell>{r.items.length}</TableCell>
                        <TableCell className="text-right font-mono">{formatMoney(r.grandTotal)}</TableCell>
                        <TableCell><span className="rounded-md bg-muted px-2 py-0.5 text-xs uppercase">{r.status}</span></TableCell>
                        <TableCell className="text-right">
                          <Button size="icon" variant="ghost" title="Print" onClick={() => printQuote(r)}><Printer className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Download PDF" onClick={() => exportPDF(r)}><Download className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Download DOCX" onClick={() => exportDOCX(r)}><FileType2 className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Share" onClick={() => share(r)}><Share2 className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Convert to Invoice" onClick={() => handleConvert(r)}><FileCheck className="h-4 w-4 text-primary" /></Button>
                          <Button size="icon" variant="ghost" title="Edit" onClick={() => setEditing({ ...r })}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Duplicate" onClick={() => duplicate(r)}><Copy className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteId(r.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
          <Pager {...pager} />
        </div>
      )}

      <Dialog open={!!editing} onOpenChange={o => !o && setEditing(null)}>
        <DialogContent className="max-w-6xl w-[96vw] p-0 gap-0 h-[95vh] max-h-[95vh] overflow-hidden flex flex-col [&>button.absolute]:hidden">
          {editing && (
            <QuotationForm
              initial={editing}
              onSave={saveQuotation}
              onCancel={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={o => !o && setDeleteId(null)}
        title="Delete this quotation?"
        description="This cannot be undone."
        destructive confirmText="Delete"
        onConfirm={async () => { if (deleteId) await remove(deleteId); }}
      />
    </>
  );
}
