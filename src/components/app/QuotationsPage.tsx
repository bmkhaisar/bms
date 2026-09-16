import { useEffect, useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Copy, Download, FileText, Pencil, Plus, Printer, Trash2, FileType2, Share2, FileCheck, Eye,
} from "lucide-react";
import {
  db, uid, nextNumber, getCompany,
  type Quotation, type Customer, type CompanySettings, type QuotationTemplate, type Invoice,
} from "@/lib/db";
import { convertQuotationToInvoice, updateLinkedDraftInvoiceFromQuotation, isInvoiceImmutable } from "@/modules/documents/quotationConversion";
import { useLive } from "@/lib/useLive";
import { formatDate, formatMoney } from "@/lib/format";
import { downloadQuotationPDF, downloadQuotationDOCX, exportQuotationPDF } from "@/lib/quotationExport";
import { QuotationForm } from "./QuotationForm";
import { QuotationQuickPreviewModal } from "./QuotationQuickPreviewModal";
import { ListToolbar, EmptyState, usePagination, Pager } from "./ListHelpers";
import { ConfirmDialog } from "./ConfirmDialog";
import { ListSkeleton } from "./Skeletons";
import { BmsShareDialog, type ShareDocumentData } from "./share";
import { useInitialLoading } from "@/lib/useInitialLoading";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { getNextDocumentNumber } from "@/lib/numberingClient";
import { freezeQuotationSnapshots } from "@/modules/documents/quotationSnapshot";
import { appQueryClient } from "@/lib/queryClient";
import { reconcileDocumentPostSuccess } from "@/lib/reconciliation";
import { authoritativeDeleteDraft, authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";
import { ensureActiveFinancialYearServerFn } from "@/functions/ensureFinancialYearFn";
import { normalizeQuotationRecord } from "@/modules/documents/quotationNormalization";
import { useDocumentDeepLink, documentDeepLink } from "@/lib/useDocumentDeepLink";
import { useNavigate } from "@tanstack/react-router";

export function QuotationsPage() {
  const rawRows = useLive<Quotation>(() => db().quotations.orderBy("createdAt").reverse().toArray());
  const rows = useMemo(() => rawRows.map(normalizeQuotationRecord), [rawRows]);
  const customers = useLive<Customer>(() => db().customers.orderBy("name").toArray());
  const templates = useLive<QuotationTemplate>(() => db().quotationTemplates.orderBy("name").toArray());
  const invoices = useLive<Invoice>(() => db().invoices.orderBy("createdAt").reverse().toArray());
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, Quotation | null>>(new Map());
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<"new" | "old" | "amount" | "number">("new");
  const [editing, setEditing] = useState<Quotation | null>(null);
  const [previewQuotation, setPreviewQuotation] = useState<Quotation | null>(null);
  const [shareQuotation, setShareQuotation] = useState<Quotation | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const initialLoading = useInitialLoading();

  const { user } = useAuth();
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const navigate = useNavigate();

  const { closeDocument: closeQuotationEditor, markManualOpen } = useDocumentDeepLink({
    documents: rows,
    onOpen: (quotation) => setEditing({ ...quotation }),
    onClose: () => setEditing(null),
  });

  useEffect(() => { getCompany().then(setCompany); }, []);

  // Deep-link support: auto-filter and open quotation editor/preview
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    if (queryParam) setQ(queryParam);
  }, []);

  const cust = (id: string) => customers.find(c => c.id === id);
  const tpl = (id?: string) => templates.find(t => t.id === id) || templates.find(t => t.isDefault);

  const effectiveRows = useMemo(() => {
    const list: Quotation[] = [];
    const seen = new Set<string>();

    for (const r of rows) {
      if (optimisticOverrides.has(r.id)) {
        const over = optimisticOverrides.get(r.id);
        if (over) {
          list.push(over);
          seen.add(r.id);
        }
      } else {
        list.push(r);
        seen.add(r.id);
      }
    }

    for (const [id, over] of optimisticOverrides.entries()) {
      if (over && !seen.has(id)) {
        list.unshift(over);
      }
    }

    return list;
  }, [rows, optimisticOverrides]);

  let filtered = effectiveRows.filter(r => {
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

  async function resolveFinancialYear(idToken?: string) {
    if (activeFinancialYear) return activeFinancialYear;
    if (!activeCompany?.id || !idToken) throw new Error("A signed-in company is required.");
    const result = await ensureActiveFinancialYearServerFn({ data: { idToken, companyId: activeCompany.id } });
    if (!result.success) throw new Error(result.error || "A current financial year is required.");
    return result.financialYear as any;
  }

  async function openNew() {
    markManualOpen();
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const financialYear = await resolveFinancialYear(idToken);
    const number = await getNextDocumentNumber({
      kind: "quotation",
      companyId: activeCompany?.id,
      financialYearId: financialYear.id,
      fyName: financialYear.name,
      idToken,
      customPrefix: activeCompany?.quotationPrefix,
    });
    setEditing({
      id: uid(), number, date: Date.now(), customerId: "",
      items: [], subtotal: 0, discountTotal: 0, gstTotal: 0, roundOff: 0, grandTotal: 0,
      status: "draft", createdAt: Date.now(), financialYearId: financialYear.id, extraCharges: [],
    });
  }
  async function duplicate(r: Quotation) {
    markManualOpen();
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const financialYear = await resolveFinancialYear(idToken);
    const number = await getNextDocumentNumber({
      kind: "quotation",
      companyId: activeCompany?.id,
      financialYearId: financialYear.id,
      fyName: financialYear.name,
      idToken,
      customPrefix: activeCompany?.quotationPrefix,
    });
    setEditing({ ...r, id: uid(), number, financialYearId: financialYear.id, createdAt: Date.now(), date: Date.now(), status: "draft" });
  }
  async function saveQuotation(next: Quotation) {
    const comp = activeCompany || company;
    const toSave: Quotation = freezeQuotationSnapshots({
      ...next,
      createdAt: next.createdAt || Date.now(),
      updatedAt: Date.now(),
    }, comp);

    // Optimistic UI update
    setOptimisticOverrides(prev => new Map(prev).set(toSave.id, toSave));

    try {
      if (activeCompany?.id) {
        await authoritativeSaveEntity({
          companyId: activeCompany.id,
          financialYearId: toSave.financialYearId || activeFinancialYear?.id,
          kind: "quotation",
          entity: toSave,
          uid: user?.uid,
          action: rows.find(r => r.id === toSave.id) ? "update" : "create",
        });
      } else {
        await db().quotations.put(toSave);
      }

      toast.success("Quotation saved");
      closeQuotationEditor();
    } catch (err: any) {
      setOptimisticOverrides(prev => {
        const nextMap = new Map(prev);
        nextMap.delete(toSave.id);
        return nextMap;
      });
      console.error("[saveQuotation] Failed to save quotation:", err);
      toast.error(err?.message || "Failed to save quotation to cloud");
    }
  }

  async function saveQuotationDraft(next: Quotation) {
    const draft: Quotation = { ...next, status: "draft", updatedAt: Date.now() };
    if (activeCompany?.id) {
      await authoritativeSaveEntity({
        companyId: activeCompany.id,
        financialYearId: draft.financialYearId || activeFinancialYear?.id,
        kind: "quotation",
        entity: draft,
        uid: user?.uid,
        action: rows.some((row) => row.id === draft.id) ? "update" : "create",
      });
    } else {
      await db().quotations.put(draft);
    }
    setOptimisticOverrides((current) => new Map(current).set(draft.id, draft));
  }

  async function remove(id: string) {
    // Immediate optimistic UI removal
    setOptimisticOverrides(prev => new Map(prev).set(id, null));

    try {
      if (activeCompany?.id) {
        await authoritativeDeleteDraft({
          companyId: activeCompany.id,
          kind: "quotation",
          id,
          uid: user?.uid,
        });
      } else {
        await db().quotations.delete(id);
      }

      toast.success("Quotation deleted");
    } catch (err: any) {
      setOptimisticOverrides(prev => {
        const nextMap = new Map(prev);
        nextMap.delete(id);
        return nextMap;
      });
      console.error("[removeQuotation] Failed to delete quotation:", err);
      toast.error(err?.message || "Failed to delete quotation from cloud. Restored.");
    }
  }

  async function handleConvert(r: Quotation) {
    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}
    const financialYear = await resolveFinancialYear(idToken);
    await convertQuotationToInvoice(r, {
      activeCompany,
      financialYearId: r.financialYearId || financialYear.id,
      fyName: financialYear.name,
      user,
      idToken,
      companySettings: company,
    });
  }

  const linkedInvoice = editing?.convertedInvoiceId
    ? invoices.find((invoice) => invoice.id === editing.convertedInvoiceId)
    : undefined;
  const linkedInvoiceIsPosted = linkedInvoice ? isInvoiceImmutable(linkedInvoice) : false;
  const quotationChangedSinceLink = Boolean(
    editing && linkedInvoice &&
    Number(editing.updatedAt || editing.createdAt) > Number(linkedInvoice.sourceQuotationUpdatedAt || linkedInvoice.createdAt),
  );

  async function updateLinkedDraft() {
    if (!editing || !linkedInvoice) return;
    try {
      await updateLinkedDraftInvoiceFromQuotation(editing, linkedInvoice, { activeCompany, user });
      toast.success(`Linked draft invoice ${linkedInvoice.number} updated`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update linked draft invoice");
    }
  }

  function getEffectiveCompany(r: Quotation): CompanySettings | null {
    const isDraft = !r.status || r.status === "draft";
    const resolved = isDraft
      ? (activeCompany || r.companySnapshot || company)
      : (r.companySnapshot || activeCompany || company);
    return (resolved as CompanySettings) || null;
  }

  async function exportPDF(r: Quotation) {
    const effComp = getEffectiveCompany(r);
    if (!effComp) return;
    await downloadQuotationPDF(r, effComp, cust(r.customerId), tpl(r.templateId));
    toast.success(`Downloaded ${r.number}.pdf`);
  }
  async function exportDOCX(r: Quotation) {
    const effComp = getEffectiveCompany(r);
    if (!effComp) return;
    await downloadQuotationDOCX(r, effComp, cust(r.customerId));
    toast.success(`Downloaded ${r.number}.docx`);
  }
  async function printQuote(r: Quotation) {
    const effComp = getEffectiveCompany(r);
    if (!effComp) return;
    const blob = await exportQuotationPDF(r, effComp, cust(r.customerId), tpl(r.templateId));
    const url = URL.createObjectURL(blob);
    const w = window.open(url);
    if (w) setTimeout(() => w.print(), 800);
  }

  function buildQuotationShareData(quotation: Quotation): ShareDocumentData {
    const isDraft = !quotation.status || quotation.status === "draft";
    const effComp = isDraft
      ? (activeCompany || quotation.companySnapshot || company)
      : (quotation.companySnapshot || activeCompany || company);
    const customer = cust(quotation.customerId) || (quotation.customerSnapshot as any);
    const activeCc = (activeCompany as any)?.defaultShareCcEmail || (company as any)?.defaultShareCcEmail;

    return {
      kind: "quotation",
      documentId: quotation.id,
      documentNumber: quotation.number,
      date: quotation.date,
      totalAmount: quotation.grandTotal,
      currencySymbol: "₹",
      company: {
        id: (effComp as any)?.companyId || (effComp as any)?.id,
        name: (effComp as any)?.name || "Company",
        legalName: (effComp as any)?.legalName || (effComp as any)?.name,
        email: (effComp as any)?.email,
        phone: (effComp as any)?.phone || (effComp as any)?.mobile,
        logo: (effComp as any)?.logoUrl || (effComp as any)?.logo,
        defaultShareCcEmail: activeCc,
      },
      party: {
        partyId: quotation.customerId,
        partyCode: customer?.partyCode,
        name: customer?.name || "Customer",
        companyName: customer?.company || (customer as any)?.tradingName,
        email: customer?.email,
        phone: customer?.mobile || customer?.phone,
        country: customer?.country,
      },
      generatePdfBlob: async () => {
        return exportQuotationPDF(quotation, effComp as any, customer as any, tpl(quotation.templateId));
      },
    };
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
                    <TableHead>Customer</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Valid Until</TableHead>
                    <TableHead>Items</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-64 text-right">Actions</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {pager.items.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="font-mono font-semibold text-primary">{r.number}</TableCell>
                        <TableCell className="font-medium">{cust(r.customerId)?.name || "—"}</TableCell>
                        <TableCell>{formatDate(r.date)}</TableCell>
                        <TableCell className="text-muted-foreground">{r.validity ? formatDate(r.validity) : "—"}</TableCell>
                        <TableCell>{r.items.length}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">{formatMoney(r.grandTotal)}</TableCell>
                        <TableCell><span className="rounded-md bg-muted px-2 py-0.5 text-xs uppercase font-semibold">{r.status}</span></TableCell>
                        <TableCell className="text-right">
                          {/* 1. Preview */}
                          <Button size="icon" variant="ghost" title="Quick Preview" onClick={() => setPreviewQuotation(r)} className="text-primary hover:bg-primary/10">
                            <Eye className="h-4 w-4" />
                          </Button>
                          {/* 2. Download PDF */}
                          <Button size="icon" variant="ghost" title="Download PDF" onClick={() => exportPDF(r)}>
                            <Download className="h-4 w-4 text-blue-600" />
                          </Button>
                          {/* 3. Share (PRD § 2 & Correction 2: Saved quotation) */}
                          <Button size="icon" variant="ghost" title="Share Quotation" onClick={() => setShareQuotation(r)}>
                            <Share2 className="h-4 w-4 text-primary" />
                          </Button>
                          {/* 4. Print */}
                          <Button size="icon" variant="ghost" title="Print" onClick={() => printQuote(r)}>
                            <Printer className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title="Convert to Invoice" onClick={() => handleConvert(r)} className="text-emerald-600 hover:bg-emerald-500/10">
                            <FileCheck className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" title="Edit" onClick={() => { markManualOpen(); setEditing({ ...r }); }}><Pencil className="h-4 w-4" /></Button>
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

      {/* Quick Preview Modal (PRD §§ 32, 33) */}
      <QuotationQuickPreviewModal
        open={!!previewQuotation}
        onOpenChange={(o) => !o && setPreviewQuotation(null)}
        quotation={previewQuotation}
        onEdit={(q) => { markManualOpen(); setEditing({ ...q }); }}
        onConvert={(q) => handleConvert(q)}
        onShare={(q) => setShareQuotation(q)}
      />

      <Dialog open={!!editing} onOpenChange={o => !o && closeQuotationEditor()}>
        <DialogContent className="max-w-6xl w-[96vw] p-0 gap-0 h-[95vh] max-h-[95vh] overflow-hidden flex flex-col [&>button.absolute]:hidden">
          {editing && linkedInvoice && (
            <div className="shrink-0 border-b bg-muted/35 px-4 py-2.5 text-xs sm:flex sm:items-center sm:justify-between sm:gap-3">
              <div>
                <div className="font-semibold">
                  {linkedInvoiceIsPosted
                    ? `Invoice ${linkedInvoice.number} is already posted.`
                    : `Linked Draft Invoice: ${linkedInvoice.number}`}
                </div>
                <div className="mt-0.5 text-muted-foreground">
                  {linkedInvoiceIsPosted
                    ? "Changes to this quotation will not modify the posted invoice."
                    : quotationChangedSinceLink
                      ? "This quotation has changed since the linked draft invoice was created."
                      : "The linked draft invoice matches this quotation."}
                </div>
              </div>
              <div className="mt-2 flex shrink-0 gap-2 sm:mt-0">
                <Button size="sm" variant="outline" onClick={() => navigate({ to: documentDeepLink("/invoices", linkedInvoice.id) as never })}>
                  View Invoice
                </Button>
                {!linkedInvoiceIsPosted && quotationChangedSinceLink && (
                  <Button size="sm" onClick={updateLinkedDraft}>Update Linked Draft Invoice</Button>
                )}
              </div>
            </div>
          )}
          {editing && (
            <QuotationForm
              initial={editing}
              onSave={saveQuotation}
              onDraftSave={saveQuotationDraft}
              onCancel={closeQuotationEditor}
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

      {/* Unified BMS Share Center Dialog (PRD § 1, 2) */}
      <BmsShareDialog
        open={Boolean(shareQuotation)}
        onOpenChange={(o) => !o && setShareQuotation(null)}
        document={shareQuotation ? buildQuotationShareData(shareQuotation) : null}
      />
    </>
  );
}
