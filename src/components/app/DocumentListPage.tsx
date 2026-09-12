import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { LineItemsEditor } from "./LineItemsEditor";
import { computeLine, computeTotals, applyStockDelta } from "@/lib/calc";
import type { Customer, Supplier, LineItem, Invoice, Quotation, Purchase, CompanySettings, ExtraCharge } from "@/lib/db";
import { db, nextNumber, uid, getCompany } from "@/lib/db";
import { useEffect, useState } from "react";
import { useLive } from "@/lib/useLive";
import { toDateInput, fromDateInput, formatDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "./ConfirmDialog";
import { Copy, Download, FileText, Pencil, Plus, Printer, Trash2, UserPlus, Truck, HandCoins, Loader2 } from "lucide-react";
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
import { postInvoiceTransaction, postPurchaseTransaction, amendPostedInvoiceTransaction, postReceiptTransaction } from "@/modules/accounting/services/documentPostingService";
import { ensureCustomerLedger, ensureSupplierLedger } from "@/modules/accounting/services/partyLedgerSyncService";
import { QuickCreateCustomerDrawer } from "./QuickCreateCustomerDrawer";
import { QuickCreateSupplierDrawer } from "./QuickCreateSupplierDrawer";
import { determineInterState } from "@/modules/tax/taxEngine";
import { createCompanySnapshot } from "@/modules/company/types";
import { createSignatorySnapshot } from "@/modules/company/signatoryHelper";
import { PartySearchSelect } from "./PartySearchSelect";
import { CustomerInsightDrawer } from "./CustomerInsightDrawer";
import { SupplierInsightDrawer } from "./SupplierInsightDrawer";
import { DocumentCopyModal } from "./DocumentCopyModal";
import { InvoicePartyStatusPanel } from "./InvoicePartyStatusPanel";
import { PartyAddressSelect } from "./PartyAddressSelect";
import { AdvanceRestrictionModal } from "./AdvanceRestrictionModal";
import { CalculationReconciliationModal } from "./CalculationReconciliationModal";
import { getPartyFinancialInsight } from "@/modules/accounting/services/partyAdvanceService";
import { validateDocumentTotals } from "@/modules/tax/canonicalCalculation";
import { formatAddressLines } from "./AddressDrawer";

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
  const [openCustomerDrawer, setOpenCustomerDrawer] = useState(false);
  const [openSupplierDrawer, setOpenSupplierDrawer] = useState(false);
  const [openReceiptModal, setOpenReceiptModal] = useState(false);
  const [selectedInvoiceForReceipt, setSelectedInvoiceForReceipt] = useState<Invoice | null>(null);
  const [receiptAmount, setReceiptAmount] = useState<number>(0);
  const [editing, setEditing] = useState<T | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  // Document copy export modal
  const [copyModalDoc, setCopyModalDoc] = useState<T | null>(null);
  // Live party insight drawers
  const [insightCustomerId, setInsightCustomerId] = useState<string | null>(null);
  const [insightSupplierId, setInsightSupplierId] = useState<string | null>(null);

  // Non-GST commercial invoice mode toggle
  const [enableGst, setEnableGst] = useState<boolean>(true);

  // Additional charge temp fields
  const [chargeName, setChargeName] = useState("");
  const [chargeAmount, setChargeAmount] = useState<number>(0);
  const [savingDoc, setSavingDoc] = useState<boolean>(false);
  const [recordingReceipt, setRecordingReceipt] = useState<boolean>(false);

  // Advance payment restriction modal state (PRD §§ 16-18)
  const [advanceRestrictionData, setAdvanceRestrictionData] = useState<{
    open: boolean;
    partyName: string;
    availableAdvance: number;
    invoiceTotal: number;
    pendingInvoice: Invoice;
  } | null>(null);

  // Authoritative calculation reconciliation modal state (PRD §§ 48-50)
  const [reconciliationData, setReconciliationData] = useState<{
    open: boolean;
    clientTotal: number;
    authoritativeTotal: number;
    pendingInvoice: Invoice;
  } | null>(null);

  // Posting button progression (PRD § 55)
  const [postingPhase, setPostingPhase] = useState<"idle" | "validating" | "calculating" | "posting" | "posted">("idle");

  useEffect(() => { getCompany().then(setCompany); }, []);
  const initialLoading = useInitialLoading();

  function getNormalizedDoc(doc: T): NormalizedDocument {
    const isInv = kind === "invoice";
    const party = (doc as any).customerSnapshot || (doc as any).supplierSnapshot || (partyById((doc as any).customerId ?? (doc as Purchase).supplierId) || { name: "Client" }) as any;
    const docCompany = (doc as any).companySnapshot || activeCompany || company || {};
    const isTaxDoc = enableGst && (doc.gstTotal > 0 || (doc as Invoice).isIgst);

    return {
      kind: kind as any,
      title: isTaxDoc ? "Tax Invoice" : kind === "invoice" ? "Commercial Invoice" : kind === "quotation" ? "Quotation" : "Purchase Bill",
      number: doc.number,
      date: doc.date,
      dueDate: (doc as Invoice).dueDate,
      company: {
        name: docCompany.name,
        legalName: docCompany.legalName || docCompany.name,
        address: docCompany.address,
        city: docCompany.city,
        state: docCompany.state,
        pincode: docCompany.pincode,
        gstin: docCompany.gstin,
        pan: docCompany.pan,
        phone: docCompany.phone || docCompany.mobile,
        email: docCompany.email,
        logo: docCompany.logoUrl || (docCompany as any).logo,
        bankName: docCompany.bankName,
        bankAccountNo: docCompany.bankAccount || docCompany.bankAccountNo,
        bankIfsc: docCompany.bankIfsc,
        upiId: docCompany.upiId,
        terms: docCompany.terms,
        authorizedSignatory: docCompany.authorizedSignatory,
        designation: docCompany.designation,
        signatureMode: docCompany.signatureMode,
        typedSignatureStyle: docCompany.typedSignatureStyle,
        signatureUrl: docCompany.signatureUrl,
        stampUrl: docCompany.stampUrl,
        stampMode: docCompany.stampMode,
        showSignature: docCompany.showSignature,
        showStamp: docCompany.showStamp,
        showSignatoryName: docCompany.showSignatoryName,
        showDesignation: docCompany.showDesignation,
        showSignatureDate: docCompany.showSignatureDate,
        signatureDateMode: docCompany.signatureDateMode,
        customSignatureDate: docCompany.customSignatureDate,
      },
      signatoryOverride: (doc as any).signatoryOverride,
      signatorySnapshot: (doc as any).signatorySnapshot,
      party: {
        name: party.name,
        company: party.company,
        address: party.address,
        city: party.city,
        state: party.state,
        pincode: party.pincode,
        gstin: party.gstin,
        phone: party.mobile || party.phone,
        email: party.email,
        placeOfSupply: party.state,
      },
      items: (doc as any).lineSnapshots && (doc as any).lineSnapshots.length > 0 ? (doc as any).lineSnapshots : doc.items,
      subtotal: doc.subtotal,
      discountTotal: doc.discountTotal,
      cgstTotal: (doc as Invoice).cgstTotal,
      sgstTotal: (doc as Invoice).sgstTotal,
      igstTotal: (doc as Invoice).igstTotal,
      gstTotal: doc.gstTotal,
      extraCharges: (doc as Invoice).extraCharges,
      extraChargesTotal: (doc as Invoice).extraChargesTotal,
      roundOff: doc.roundOff,
      grandTotal: doc.grandTotal,
      amountPaid: (doc as Invoice).amountPaid,
      balance: (doc as Invoice).balance,
      notes: doc.notes,
      terms: (doc as any).terms,
      enableGst: isTaxDoc,
      watermarkMode: (docCompany as any).watermarkSetting || "off",
    };
  }

  // Deep-link support
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const queryParam = params.get("q");
    const idParam = params.get("id");
    if (queryParam) setQ(queryParam);
    if (idParam && rows.length > 0) {
      const match = rows.find((r) => r.id === idParam || (r as AnyDoc).number === idParam);
      if (match) setPreview(match);
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

    const isCompanyNonGst = (activeCompany as any)?.gstRegistrationMode === "unregistered";
    setEnableGst(!isCompanyNonGst);

    const base = {
      id: uid(), number, date: Date.now(), items: [] as LineItem[],
      subtotal: 0, discountTotal: 0, gstTotal: 0, roundOff: 0, grandTotal: 0,
      createdAt: Date.now(), extraCharges: [] as ExtraCharge[], extraChargesTotal: 0,
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

  function openEdit(r: T) {
    setEditing({ ...r });
    const isDocNonGst = (r as any).gstTotal === 0 && (r as any).cgstTotal === 0 && (r as any).igstTotal === 0 && (r as any).items?.every((it: LineItem) => it.gstRate === 0);
    setEnableGst(!isDocNonGst);
    setOpen(true);
  }

  // Auto-update Intra/Inter state when party or place of supply changes
  function onPartySelect(selectedPartyId: string) {
    if (selectedPartyId === "__new__") {
      if (tableFor === "customer") setOpenCustomerDrawer(true);
      else setOpenSupplierDrawer(true);
      return;
    }

    if (!editing) return;
    const selectedParty = partyById(selectedPartyId);
    const isInter = determineInterState({
      companyState: activeCompany?.state || (company as any)?.state,
      partyState: (selectedParty as any)?.state,
    });

    if (kind === "invoice") {
      setEditing({
        ...editing,
        customerId: selectedPartyId,
        isIgst: isInter,
        billingAddress: selectedParty?.address || "",
        shippingAddress: selectedParty?.address || "",
      } as T);
    } else if (kind === "quotation") {
      setEditing({
        ...editing,
        customerId: selectedPartyId,
      } as T);
    } else {
      setEditing({
        ...editing,
        supplierId: selectedPartyId,
      } as T);
    }
  }

  function addExtraCharge() {
    if (!editing || !chargeName.trim() || chargeAmount <= 0) return;
    const current = (editing as any).extraCharges ? [...(editing as any).extraCharges] : [];
    const updated = [...current, { label: chargeName.trim(), amount: Number(chargeAmount) }];
    const total = updated.reduce((s, c) => s + c.amount, 0);
    setEditing({
      ...editing,
      extraCharges: updated,
      extraChargesTotal: total,
    } as T);
    setChargeName("");
    setChargeAmount(0);
  }

  function removeExtraCharge(idx: number) {
    if (!editing || !(editing as any).extraCharges) return;
    const updated = [...(editing as any).extraCharges];
    updated.splice(idx, 1);
    const total = updated.reduce((s: number, c: ExtraCharge) => s + c.amount, 0);
    setEditing({
      ...editing,
      extraCharges: updated,
      extraChargesTotal: total,
    } as T);
  }

  function mapFriendlyError(err?: string): string {
    if (!err) return "Failed to post document. Please try again.";
    if (err.includes("PERMISSION_DENIED") || err.includes("permission")) {
      return "You don't have permission to post this invoice.";
    }
    if (err.includes("ADVANCE_REQUIRED") || err.includes("advance")) {
      return "This party requires advance payment before billing.";
    }
    if (err.includes("Rule 46") || err.includes("numbering")) {
      return "The invoice number does not conform to GST statutory numbering requirements.";
    }
    if (err.includes("discrepancy") || err.includes("validation") || err.includes("changed during validation")) {
      return "Invoice totals changed during validation. Review the updated total.";
    }
    return err;
  }

  async function save() {
    if (!editing) return;
    const partyId = (editing as any).customerId ?? (editing as Purchase).supplierId;
    if (!partyId) { toast.error(`Please select a ${tableFor}`); return; }
    if (!editing.items.length) { toast.error("Please add at least one line item"); return; }

    setSavingDoc(true);
    try {

    const isIgst = kind === "invoice" && (editing as unknown as Invoice).isIgst;
    const extraCharges = (editing as any).extraCharges || [];
    const extraChargesTotal = extraCharges.reduce((s: number, c: ExtraCharge) => s + (Number(c.amount) || 0), 0);

    const totals = computeTotals(editing.items, isIgst, { enableGst });
    const finalGrandTotal = totals.grandTotal + extraChargesTotal;
    const party = partyById(partyId);

    const patched = {
      ...(editing as AnyDoc),
      ...totals,
      extraCharges,
      extraChargesTotal,
      grandTotal: finalGrandTotal,
      ...(tableFor === "customer" ? { customerSnapshot: party as Customer | undefined } : { supplierSnapshot: party as Supplier | undefined }),
    } as AnyDoc;

    let idToken: string | undefined;
    try { idToken = await user?.getIdToken(); } catch {}

    if (kind === "invoice") {
      const inv = patched as Invoice;
      setPostingPhase("validating");

      // 1. Advance Party Restriction Check (PRD §§ 16-18, 100, 106)
      if (tableFor === "customer") {
        const partyInsight = await getPartyFinancialInsight(partyId);
        const finalGrandTotalPaise = Math.round(finalGrandTotal * 100);

        if (partyInsight.paymentPolicy === "ADVANCE") {
          if (partyInsight.availableAdvancePaise < finalGrandTotalPaise) {
            setPostingPhase("idle");
            setSavingDoc(false);
            setAdvanceRestrictionData({
              open: true,
              partyName: party?.name || "Customer",
              availableAdvance: partyInsight.availableAdvanceRupees,
              invoiceTotal: finalGrandTotal,
              pendingInvoice: inv,
            });
            return;
          } else {
            // Sufficient advance available! Auto-allocate advance against invoice (PRD § 17)
            inv.advanceAllocatedPaise = finalGrandTotalPaise;
            inv.amountPaid = finalGrandTotal;
            inv.balance = 0;
            inv.status = "paid";
          }
        }
      }

      // 2. Authoritative Server Calculation Preflight (PRD §§ 48-50, 99)
      setPostingPhase("calculating");
      const validation = validateDocumentTotals(inv, activeCompany || company || {});
      if (!validation.matches) {
        setPostingPhase("idle");
        setSavingDoc(false);
        setReconciliationData({
          open: true,
          clientTotal: inv.grandTotal,
          authoritativeTotal: validation.authoritative.grandTotal,
          pendingInvoice: {
            ...inv,
            ...validation.authoritative,
            subtotal: validation.authoritative.subtotal,
            taxableAmount: validation.authoritative.taxableValue,
            gstTotal: validation.authoritative.gstTotal,
            cgstTotal: validation.authoritative.cgst,
            sgstTotal: validation.authoritative.sgst,
            igstTotal: validation.authoritative.igst,
            roundOff: validation.authoritative.roundOff,
            grandTotal: validation.authoritative.grandTotal,
            balance: Math.max(0, validation.authoritative.grandTotal - inv.amountPaid),
          },
        });
        return;
      }

      setPostingPhase("posting");
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
            customerLedgerId: custLedger,
            idToken,
            uid: user.uid,
            amendmentReason: "Invoice edit and amendment",
          });
          if (!res.success) {
            setPostingPhase("idle");
            toast.error(mapFriendlyError(res.error));
            return;
          }
        } else {
          const res = await postInvoiceTransaction({
            companyId: activeCompany.id,
            financialYearId: activeFinancialYear.id,
            invoice: inv,
            company: activeCompany,
            customerLedgerId: custLedger,
            idToken,
            uid: user.uid,
          });
          if (!res.success) {
            setPostingPhase("idle");
            toast.error(mapFriendlyError(res.error));
            return;
          }
        }
      } else {
        await db().invoices.put(inv);
      }
      setPostingPhase("posted");
    } else if (kind === "purchase") {
      const pu = patched as Purchase;
      pu.balance = Math.max(0, pu.grandTotal - pu.amountPaid);
      pu.status = pu.balance <= 0.01 ? "paid" : pu.amountPaid > 0 ? "partial" : "unpaid";

      const prev = await db().purchases.get(pu.id);
      if (prev) await applyStockDelta(prev.items, -1);
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
          supplierLedgerId: suppLedger,
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
      const q = patched as Quotation;
      const comp = activeCompany || company;
      const toSave: Quotation = {
        ...q,
        companySnapshot:
          q.status !== "draft"
            ? q.companySnapshot || (comp ? createCompanySnapshot(comp as any) : undefined)
            : q.companySnapshot,
        signatorySnapshot:
          q.status !== "draft"
            ? q.signatorySnapshot ||
              (comp ? createSignatorySnapshot(comp as any, q.signatoryOverride, q.date) : undefined)
            : q.signatorySnapshot,
      };
      await db().quotations.put(toSave);
    }

      toast.success("Document saved successfully");
      setOpen(false);
      setEditing(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save document");
    } finally {
      setSavingDoc(false);
    }
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
    toast.success("Document deleted");
  }

  async function duplicate(r: T) {
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
    const totals = computeTotals(items, inv.isIgst, { enableGst });
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
    toast.success(`Loaded items from quotation ${quote.number}`);
  }

  async function recordQuickReceipt() {
    if (!selectedInvoiceForReceipt || receiptAmount <= 0) return;
    setRecordingReceipt(true);
    try {
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

      const party = partyById(selectedInvoiceForReceipt.customerId);
      const customerLedgerId = (party as any)?.ledgerId || `led_${activeCompany?.id || "default"}_cust_${selectedInvoiceForReceipt.customerId}`;
      const defaultCash = `led_${activeCompany?.id || "default"}_cash`;

      const receiptRecord = {
        id: uid(),
        number,
        date: Date.now(),
        customerId: selectedInvoiceForReceipt.customerId,
        invoiceId: selectedInvoiceForReceipt.id,
        amount: receiptAmount,
        mode: "cash" as const,
        paymentMethod: "cash",
        settlementLedgerId: defaultCash,
        createdAt: Date.now(),
      };

      if (activeCompany?.id && activeFinancialYear?.id && user) {
        await postReceiptTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          receipt: receiptRecord,
          customerLedgerId,
          settlementLedgerId: defaultCash,
          idToken,
          uid: user.uid,
        });
      }

      // Update invoice balance
      const newPaid = (selectedInvoiceForReceipt.amountPaid || 0) + receiptAmount;
      const newBalance = Math.max(0, selectedInvoiceForReceipt.grandTotal - newPaid);
      const updatedInv = {
        ...selectedInvoiceForReceipt,
        amountPaid: newPaid,
        balance: newBalance,
        status: newBalance <= 0.01 ? "paid" as const : "partial" as const,
      };
      await db().invoices.put(updatedInv);

      toast.success(`Receipt ${number} posted against Invoice ${selectedInvoiceForReceipt.number}`);
      setOpenReceiptModal(false);
      setSelectedInvoiceForReceipt(null);
    } catch (err) {
      console.error("Failed to record receipt:", err);
      toast.error("Failed to record receipt");
    } finally {
      setRecordingReceipt(false);
    }
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 animate-fade-in">
        <div>
          <h2 className="text-xl font-bold sm:text-2xl tracking-tight">{title}</h2>
          <p className="text-xs text-muted-foreground">Manage, issue, track and vector-print {title.toLowerCase()}.</p>
        </div>
        <Button className="gap-2 shadow-sm" onClick={openNew}>
          <Plus className="h-4 w-4" /> {addLabel}
        </Button>
      </div>

      {initialLoading ? (
        <ListSkeleton columns={kind === "quotation" ? 6 : 7} />
      ) : (
        <div className="animate-fade-in">
          <ListToolbar query={q} onQuery={setQ} placeholder="Search by number, party name, or details…" />

          {rows.length === 0 ? (
            <EmptyState
              title={`No ${title.toLowerCase()} yet`}
              description={`Create your first ${title.toLowerCase()} with automatic double-entry ledger linking.`}
              action={<Button className="mt-2 gap-2" onClick={openNew}><Plus className="h-4 w-4" /> {addLabel}</Button>}
            />
          ) : (
            <Card className="rounded-2xl border border-border/60 bg-card/85 backdrop-blur shadow-sm overflow-hidden">
              <div className="overflow-x-auto scrollbar-hidden">
                <Table className="text-xs">
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>{tableFor === "customer" ? "Customer" : "Supplier"}</TableHead>
                      <TableHead className="text-right">Grand Total</TableHead>
                      {kind !== "quotation" && <TableHead className="text-right">Balance</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead className="w-48 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pager.items.map(r => {
                      const p = partyById((r as any).customerId ?? (r as Purchase).supplierId);
                      const isInv = kind === "invoice";
                      const invBalance = (r as unknown as Invoice).balance ?? 0;
                      return (
                        <TableRow key={r.id}>
                          <TableCell className="font-mono font-medium">{r.number}</TableCell>
                          <TableCell>{formatDate(r.date)}</TableCell>
                          <TableCell className="font-medium">
                            {p?.name ?? "—"}
                            {p?.company ? <div className="text-[10px] text-muted-foreground">{p.company}</div> : null}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{formatMoney(r.grandTotal)}</TableCell>
                          {kind !== "quotation" && (
                            <TableCell className={`text-right font-mono ${invBalance > 0 ? "text-amber-600 font-semibold" : ""}`}>
                              {formatMoney(invBalance)}
                            </TableCell>
                          )}
                          <TableCell>
                            <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] uppercase font-semibold">
                              {(r as unknown as Invoice).status}
                            </span>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isInv && invBalance > 0 && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="Record Receipt"
                                  onClick={() => {
                                    setSelectedInvoiceForReceipt(r as unknown as Invoice);
                                    setReceiptAmount(invBalance);
                                    setOpenReceiptModal(true);
                                  }}
                                >
                                  <HandCoins className="h-3.5 w-3.5 text-emerald-600" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" title="Download Copies (Original / Driver / Transport)" onClick={() => setCopyModalDoc(r)}>
                                <Download className="h-3.5 w-3.5 text-blue-600" />
                              </Button>
                              <Button size="icon" variant="ghost" title="View / Print" onClick={() => setPreview(r)}>
                                <Printer className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(r)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" title="Duplicate" onClick={() => duplicate(r)}>
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                              {kind === "quotation" && (
                                <Button size="icon" variant="ghost" title="Convert to invoice" onClick={() => convertQuotationToInvoice(r as unknown as Quotation)}>
                                  <FileText className="h-3.5 w-3.5 text-primary" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" title="Delete" onClick={() => setDeleteId(r.id)}>
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
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
          <Pager {...pager} />
        </div>
      )}

      {/* Editor Dialog */}
      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setEditing(null); }}>
        <DialogContent className="flex h-[min(95dvh,840px)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl flex-col overflow-hidden gap-0 p-0">
          <DialogHeader className="shrink-0 border-b px-4 py-3 sm:px-6">
            <DialogTitle className="flex items-center justify-between text-base">
              <span>{editing && rows.find(r => r.id === editing.id) ? `Edit ${title.slice(0, -1)}` : `New ${title.slice(0, -1)}`}</span>
              {kind === "invoice" && (
                <div className="flex items-center gap-2 text-xs font-normal">
                  <span className="text-muted-foreground">GST Mode:</span>
                  <Select value={enableGst ? "gst" : "nongst"} onValueChange={v => setEnableGst(v === "gst")}>
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="gst">Tax Invoice (GST)</SelectItem>
                      <SelectItem value="nongst">Commercial (Non-GST)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden overscroll-contain scrollbar-hidden px-3 py-4 sm:px-6 text-xs">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label className="text-xs">Document Number</Label>
                  <Input value={editing.number} readOnly className="font-mono text-xs bg-muted/30" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Date</Label>
                  <Input type="date" value={toDateInput(editing.date)} onChange={e => setEditing({ ...editing, date: fromDateInput(e.target.value) })} />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{tableFor === "customer" ? "Customer *" : "Supplier *"}</Label>
                    {((editing as any).customerId || (editing as Purchase).supplierId) && (
                      <button
                        type="button"
                        onClick={() => {
                          const id = (editing as any).customerId ?? (editing as Purchase).supplierId;
                          if (tableFor === "customer") setInsightCustomerId(id);
                          else setInsightSupplierId(id);
                        }}
                        className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                      >
                        <FileText className="h-3 w-3" /> View Financial History
                      </button>
                    )}
                  </div>
                  <PartySearchSelect
                    type={tableFor === "customer" ? "customer" : "supplier"}
                    value={((editing as any).customerId ?? (editing as Purchase).supplierId) || ""}
                    parties={parties}
                    onChange={(id: string) => onPartySelect(id)}
                    onAddNew={() => (tableFor === "customer" ? setOpenCustomerDrawer(true) : setOpenSupplierDrawer(true))}
                  />
                </div>

                {tableFor === "customer" && (editing as any).customerId && (
                  <div className="sm:col-span-3">
                    <InvoicePartyStatusPanel
                      party={partyById((editing as any).customerId) as any}
                      invoiceTotal={
                        computeTotals(editing.items, Boolean(kind === "invoice" && (editing as any).isIgst), { enableGst }).grandTotal +
                        ((editing as any).extraChargesTotal || 0)
                      }
                      onRecordReceipt={(_p, deficit) => {
                        setSelectedInvoiceForReceipt(null);
                        setReceiptAmount(deficit > 0 ? deficit : 0);
                        setOpenReceiptModal(true);
                      }}
                    />
                  </div>
                )}

                <div className="space-y-1 sm:col-span-3">
                  <PartyAddressSelect
                    party={partyById((editing as any).customerId ?? (editing as Purchase).supplierId)}
                    selectedAddressId={(editing as any).billingAddressId}
                    onChange={(snapshot, addressId) => {
                      setEditing({
                        ...editing,
                        billingAddressId: addressId,
                        billingAddressSnapshot: snapshot,
                        billingAddress: formatAddressLines(snapshot),
                        shippingAddress: (editing as any).shippingAddress || formatAddressLines(snapshot),
                      } as T);
                    }}
                    label={tableFor === "customer" ? "Billing Address (Saved Party Master)" : "Supplier Address (Saved Party Master)"}
                  />
                </div>

                {kind === "invoice" && (
                  <>
                    <div className="space-y-1 sm:col-span-3">
                      <Label className="text-xs">Load from Quotation (Preserves items, specs, terms)</Label>
                      <Select onValueChange={applyQuotationToInvoice}>
                        <SelectTrigger className="h-9 text-xs">
                          <SelectValue placeholder="Select an approved quotation to copy into invoice…" />
                        </SelectTrigger>
                        <SelectContent>
                          {quotations.length === 0 && <SelectItem value="__none__" disabled>No quotations available</SelectItem>}
                          {quotations.map(item => (
                            <SelectItem key={item.id} value={item.id}>
                              {item.number} · {partyById(item.customerId)?.name ?? item.customerSnapshot?.name ?? "Customer"} · {formatMoney(item.grandTotal)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Due Date</Label>
                      <Input type="date" value={toDateInput((editing as unknown as Invoice).dueDate)} onChange={e => setEditing({ ...editing, dueDate: fromDateInput(e.target.value) } as T)} />
                    </div>
                    {enableGst && (
                      <div className="space-y-1">
                        <Label className="text-xs">Tax Supply Determination</Label>
                        <Select value={(editing as unknown as Invoice).isIgst ? "igst" : "cgst"} onValueChange={v => setEditing({ ...editing, isIgst: v === "igst" } as T)}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cgst">Intra-State: CGST + SGST</SelectItem>
                            <SelectItem value="igst">Inter-State: IGST</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-1">
                      <Label className="text-xs">Advance / Amount Paid (₹)</Label>
                      <Input
                        type="number"
                        step="0.01"
                        value={(editing as unknown as Invoice).amountPaid || ""}
                        onChange={e => setEditing({ ...editing, amountPaid: Number(e.target.value) || 0 } as T)}
                        placeholder="0.00"
                      />
                    </div>
                  </>
                )}

                {kind === "purchase" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Amount Paid (₹)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={(editing as unknown as Purchase).amountPaid || ""}
                      onChange={e => setEditing({ ...editing, amountPaid: Number(e.target.value) || 0 } as T)}
                      placeholder="0.00"
                    />
                  </div>
                )}
              </div>

              {/* Line Items Editor */}
              <LineItemsEditor
                items={editing.items}
                onChange={(items) => setEditing({ ...editing, items } as T)}
                mode={kind === "purchase" ? "purchase" : "sales"}
                isIgst={kind === "invoice" ? (editing as unknown as Invoice).isIgst : false}
                enableGst={enableGst}
                customerId={kind === "invoice" || kind === "quotation" ? (editing as any).customerId : undefined}
              />

              {/* Additional Charges Section (Transportation, Freight, Installation) */}
              <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-2">
                <div className="font-semibold text-xs text-foreground flex items-center justify-between">
                  <span>Additional Charges (Transportation, Freight, Labour, Installation)</span>
                  <span className="font-mono text-xs">
                    Total: {formatMoney((editing as any).extraChargesTotal || 0)}
                  </span>
                </div>
                {((editing as any).extraCharges || []).map((chg: ExtraCharge, cIdx: number) => (
                  <div key={cIdx} className="flex items-center justify-between rounded-lg border bg-card px-3 py-1.5 text-xs">
                    <span className="font-medium">{chg.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatMoney(chg.amount)}</span>
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeExtraCharge(cIdx)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    </div>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Input
                    className="h-8 text-xs flex-1"
                    placeholder="Charge description (e.g. Transportation, Loading)"
                    value={chargeName}
                    onChange={e => setChargeName(e.target.value)}
                  />
                  <Input
                    className="h-8 w-28 text-xs text-right font-mono"
                    type="number"
                    step="0.01"
                    placeholder="Amount ₹"
                    value={chargeAmount || ""}
                    onChange={e => setChargeAmount(Number(e.target.value) || 0)}
                  />
                  <Button size="sm" variant="outline" className="h-8 text-xs gap-1" onClick={addExtraCharge}>
                    <Plus className="h-3 w-3" /> Add
                  </Button>
                </div>
              </div>

              {kind === "invoice" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">Billing Address</Label>
                    <Textarea rows={2} value={(editing as unknown as Invoice).billingAddress ?? ""} onChange={e => setEditing({ ...editing, billingAddress: e.target.value } as T)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Shipping Address</Label>
                    <Textarea rows={2} value={(editing as unknown as Invoice).shippingAddress ?? ""} onChange={e => setEditing({ ...editing, shippingAddress: e.target.value } as T)} />
                  </div>
                </div>
              )}
              <div className="space-y-1">
                <Label className="text-xs">Notes & Payment Terms</Label>
                <Textarea rows={2} value={(editing as AnyDoc).notes ?? ""} onChange={e => setEditing({ ...editing, notes: e.target.value } as T)} />
              </div>

              {/* Signatory & Stamp Document Appearance Override */}
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold text-xs text-foreground">Signatory & Stamp (Document Appearance)</div>
                    <div className="text-[11px] text-muted-foreground">Override company default signatory settings for this document.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Use Company Default</span>
                    <Switch
                      checked={!(editing as any).signatoryOverride}
                      onCheckedChange={(useDefault) => {
                        setEditing({
                          ...editing,
                          signatoryOverride: useDefault ? undefined : {
                            showSignature: true,
                            showStamp: true,
                            showSignatoryName: true,
                            showDesignation: true,
                            showSignatureDate: true,
                            signatureDateMode: "document_date",
                          },
                        } as T);
                      }}
                    />
                  </div>
                </div>

                {(editing as any).signatoryOverride && (
                  <div className="grid gap-2 sm:grid-cols-2 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between rounded border bg-background p-2">
                      <span className="text-xs">Show Signature</span>
                      <Switch
                        checked={(editing as any).signatoryOverride.showSignature ?? true}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            signatoryOverride: { ...(editing as any).signatoryOverride, showSignature: v },
                          } as T)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded border bg-background p-2">
                      <span className="text-xs">Show Stamp</span>
                      <Switch
                        checked={(editing as any).signatoryOverride.showStamp ?? true}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            signatoryOverride: { ...(editing as any).signatoryOverride, showStamp: v },
                          } as T)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded border bg-background p-2">
                      <span className="text-xs">Show Signatory Name</span>
                      <Switch
                        checked={(editing as any).signatoryOverride.showSignatoryName ?? true}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            signatoryOverride: { ...(editing as any).signatoryOverride, showSignatoryName: v },
                          } as T)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded border bg-background p-2">
                      <span className="text-xs">Show Designation</span>
                      <Switch
                        checked={(editing as any).signatoryOverride.showDesignation ?? true}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            signatoryOverride: { ...(editing as any).signatoryOverride, showDesignation: v },
                          } as T)
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between rounded border bg-background p-2 sm:col-span-2">
                      <span className="text-xs">Show Signature Date</span>
                      <Switch
                        checked={(editing as any).signatoryOverride.showSignatureDate ?? true}
                        onCheckedChange={(v) =>
                          setEditing({
                            ...editing,
                            signatoryOverride: { ...(editing as any).signatoryOverride, showSignatureDate: v },
                          } as T)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="shrink-0 gap-2 border-t bg-background px-3 py-3 sm:px-6">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={savingDoc} className="w-full sm:w-auto">Cancel</Button>
            <Button onClick={save} disabled={savingDoc} className="w-full sm:w-auto gap-1.5">
              {savingDoc ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {postingPhase === "validating"
                    ? "Validating…"
                    : postingPhase === "calculating"
                    ? "Calculating…"
                    : postingPhase === "posting"
                    ? "Posting…"
                    : postingPhase === "posted"
                    ? "Posted"
                    : kind === "invoice"
                    ? "Posting Invoice…"
                    : kind === "purchase"
                    ? "Posting Purchase…"
                    : "Saving Draft…"}
                </>
              ) : (
                kind === "invoice" ? "Post Invoice" : kind === "purchase" ? "Post Purchase" : "Save Document"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview / Print / PDF */}
      <Dialog open={!!preview} onOpenChange={o => !o && setPreview(null)}>
        <DialogContent className="max-w-5xl max-h-[95vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <DialogTitle className="flex items-center justify-between gap-2">
              <span>{preview?.number} · Document Preview</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-blue-600 border-blue-200 hover:bg-blue-50"
                  onClick={() => setCopyModalDoc(preview)}
                >
                  <Download className="h-4 w-4" /> Download / Print Copies
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => printElement("print-doc")}>
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (!preview) return;
                    const isInv = kind === "invoice";
                    const party = (partyById((preview as any).customerId ?? (preview as Purchase).supplierId) || { name: "Client" }) as any;
                    const docCompany = (preview as any).companySnapshot || activeCompany || company || {};
                    const isTaxDoc = enableGst && (preview.gstTotal > 0 || (preview as Invoice).isIgst);

                    const normDoc: NormalizedDocument = {
                      kind: kind as any,
                      title: isTaxDoc ? "Tax Invoice" : kind === "invoice" ? "Commercial Invoice" : kind === "quotation" ? "Quotation" : "Purchase Bill",
                      number: preview.number,
                      date: preview.date,
                      dueDate: (preview as Invoice).dueDate,
                      company: {
                        name: docCompany.name,
                        legalName: docCompany.legalName || docCompany.name,
                        address: docCompany.address,
                        city: docCompany.city,
                        state: docCompany.state,
                        pincode: docCompany.pincode,
                        gstin: docCompany.gstin,
                        pan: docCompany.pan,
                        phone: docCompany.phone || docCompany.mobile,
                        email: docCompany.email,
                        logo: docCompany.logoUrl || (docCompany as any).logo,
                        bankName: docCompany.bankName,
                        bankAccountNo: docCompany.bankAccount || docCompany.bankAccountNo,
                        bankIfsc: docCompany.bankIfsc,
                        upiId: docCompany.upiId,
                        terms: docCompany.terms,
                        authorizedSignatory: docCompany.authorizedSignatory,
                        designation: docCompany.designation,
                        signatureMode: docCompany.signatureMode,
                        typedSignatureStyle: docCompany.typedSignatureStyle,
                        signatureUrl: docCompany.signatureUrl,
                        stampUrl: docCompany.stampUrl,
                        stampMode: docCompany.stampMode,
                        showSignature: docCompany.showSignature,
                        showStamp: docCompany.showStamp,
                        showSignatoryName: docCompany.showSignatoryName,
                        showDesignation: docCompany.showDesignation,
                        showSignatureDate: docCompany.showSignatureDate,
                        signatureDateMode: docCompany.signatureDateMode,
                        customSignatureDate: docCompany.customSignatureDate,
                      },
                      signatoryOverride: (preview as any).signatoryOverride,
                      signatorySnapshot: (preview as any).signatorySnapshot,
                      party: {
                        name: party.name,
                        company: party.company,
                        address: party.address,
                        city: party.city,
                        state: party.state,
                        pincode: party.pincode,
                        gstin: party.gstin,
                        phone: party.mobile || party.phone,
                        email: party.email,
                        placeOfSupply: party.state,
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
                      terms: (preview as any).terms,
                      enableGst: isTaxDoc,
                      watermarkMode: (docCompany as any).watermarkSetting || "off",
                    };
                    downloadDocumentPDF(normDoc, `${preview.number}.pdf`);
                    toast.success(`Selectable Vector PDF generated: ${preview.number}.pdf`);
                  }}
                >
                  <Download className="h-4 w-4" /> Download PDF
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          {preview && (company || activeCompany) && (
            <div className="flex-1 overflow-auto scrollbar-hidden bg-muted/40 p-4 rounded-xl">
              <DocumentPrint
                company={((preview as any).companySnapshot || activeCompany || company) as any}
                kind={kind as DocumentKind}
                doc={preview as unknown as Invoice}
                party={partyById((preview as any).customerId ?? (preview as Purchase).supplierId)}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Record Quick Receipt Modal */}
      <Dialog open={openReceiptModal} onOpenChange={setOpenReceiptModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <HandCoins className="h-5 w-5 text-emerald-600" /> Record Customer Payment
            </DialogTitle>
          </DialogHeader>
          {selectedInvoiceForReceipt && (
            <div className="space-y-3 py-2 text-xs">
              <div className="rounded-lg border bg-muted/30 p-3 space-y-1">
                <div>Invoice: <strong className="font-mono">{selectedInvoiceForReceipt.number}</strong></div>
                <div>Customer: <strong>{partyById(selectedInvoiceForReceipt.customerId)?.name}</strong></div>
                <div>Outstanding Balance: <strong className="font-mono text-amber-600">{formatMoney(selectedInvoiceForReceipt.balance)}</strong></div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Received Amount (₹)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={receiptAmount || ""}
                  onChange={e => setReceiptAmount(Number(e.target.value) || 0)}
                  placeholder="0.00"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenReceiptModal(false)} disabled={recordingReceipt}>Cancel</Button>
            <Button onClick={recordQuickReceipt} disabled={recordingReceipt} className="gap-1.5">
              {recordingReceipt ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Recording Receipt…
                </>
              ) : (
                "Post Receipt"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Inline Customer Quick-Create Drawer */}
      <QuickCreateCustomerDrawer
        open={openCustomerDrawer}
        onOpenChange={setOpenCustomerDrawer}
        onCustomerCreated={(newCust) => {
          if (editing) {
            setEditing({
              ...editing,
              customerId: newCust.id,
              billingAddress: newCust.address || "",
              shippingAddress: newCust.address || "",
            } as T);
          }
        }}
      />

      {/* Inline Supplier Quick-Create Drawer */}
      <QuickCreateSupplierDrawer
        open={openSupplierDrawer}
        onOpenChange={setOpenSupplierDrawer}
        onSupplierCreated={(newSupp) => {
          if (editing) {
            setEditing({
              ...editing,
              supplierId: newSupp.id,
            } as T);
          }
        }}
      />

      {/* Customer Financial Insight Drawer */}
      <CustomerInsightDrawer
        customerId={insightCustomerId}
        open={Boolean(insightCustomerId)}
        onOpenChange={(o) => !o && setInsightCustomerId(null)}
      />

      {/* Supplier Financial Insight Drawer */}
      <SupplierInsightDrawer
        supplierId={insightSupplierId}
        open={Boolean(insightSupplierId)}
        onOpenChange={(o) => !o && setInsightSupplierId(null)}
      />

      {/* Document Copy Selection Modal */}
      <DocumentCopyModal
        open={Boolean(copyModalDoc)}
        onOpenChange={(o) => !o && setCopyModalDoc(null)}
        docData={copyModalDoc ? getNormalizedDoc(copyModalDoc) : null}
      />

      {/* Advance Payment Restriction Modal (PRD §§ 16-18) */}
      {advanceRestrictionData && (
        <AdvanceRestrictionModal
          open={advanceRestrictionData.open}
          onOpenChange={(o) => {
            if (!o) setAdvanceRestrictionData(null);
          }}
          partyName={advanceRestrictionData.partyName}
          availableAdvance={advanceRestrictionData.availableAdvance}
          invoiceTotal={advanceRestrictionData.invoiceTotal}
          onRecordReceipt={() => {
            const deficit = advanceRestrictionData.invoiceTotal - advanceRestrictionData.availableAdvance;
            setAdvanceRestrictionData(null);
            setSelectedInvoiceForReceipt(null);
            setReceiptAmount(deficit > 0 ? deficit : 0);
            setOpenReceiptModal(true);
          }}
          onSaveDraft={async () => {
            const inv = advanceRestrictionData.pendingInvoice;
            inv.status = "draft";
            inv.postingStatus = "draft";
            await db().invoices.put(inv);
            toast.success(`Invoice ${inv.number} saved as draft`);
            setAdvanceRestrictionData(null);
            setOpen(false);
            setEditing(null);
          }}
        />
      )}

      {/* Authoritative Calculation Reconciliation Modal (PRD §§ 48-50) */}
      {reconciliationData && (
        <CalculationReconciliationModal
          open={reconciliationData.open}
          onOpenChange={(o) => {
            if (!o) setReconciliationData(null);
          }}
          clientTotal={reconciliationData.clientTotal}
          authoritativeTotal={reconciliationData.authoritativeTotal}
          onConfirmAndPost={async () => {
            const inv = reconciliationData.pendingInvoice;
            setReconciliationData(null);
            setSavingDoc(true);
            setPostingPhase("posting");
            try {
              let idToken: string | undefined;
              try { idToken = await user?.getIdToken(); } catch {}

              const prev = await db().invoices.get(inv.id);
              if (prev) await applyStockDelta(prev.items, 1);
              await applyStockDelta(inv.items, -1);

              if (activeCompany?.id && activeFinancialYear?.id && user) {
                const custLedger = await ensureCustomerLedger({
                  companyId: activeCompany.id,
                  customer: partyById(inv.customerId) as Customer,
                  uid: user.uid,
                });

                if (prev && prev.postingStatus === "posted") {
                  const res = await amendPostedInvoiceTransaction({
                    companyId: activeCompany.id,
                    financialYearId: activeFinancialYear.id,
                    originalInvoice: prev,
                    correctedInvoice: inv,
                    company: activeCompany,
                    customerLedgerId: custLedger,
                    idToken,
                    uid: user.uid,
                    amendmentReason: "Invoice reconciled and posted",
                  });
                  if (!res.success) {
                    toast.error(mapFriendlyError(res.error));
                    return;
                  }
                } else {
                  const res = await postInvoiceTransaction({
                    companyId: activeCompany.id,
                    financialYearId: activeFinancialYear.id,
                    invoice: inv,
                    company: activeCompany,
                    customerLedgerId: custLedger,
                    idToken,
                    uid: user.uid,
                  });
                  if (!res.success) {
                    toast.error(mapFriendlyError(res.error));
                    return;
                  }
                }
              } else {
                await db().invoices.put(inv);
              }

              toast.success("Invoice posted successfully with verified totals");
              setOpen(false);
              setEditing(null);
            } catch (err: any) {
              toast.error(err?.message || "Failed to post reconciled invoice");
            } finally {
              setSavingDoc(false);
              setPostingPhase("idle");
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(deleteId)}
        onOpenChange={o => !o && setDeleteId(null)}
        title={`Delete this ${title.slice(0, -1).toLowerCase()}?`}
        description="This cannot be undone. Inventory and stock movements will be reversed."
        destructive
        confirmText="Delete"
        onConfirm={async () => {
          if (deleteId) await remove(deleteId);
        }}
      />
    </>
  );
}
