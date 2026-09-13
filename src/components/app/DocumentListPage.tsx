import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { LineItemsEditor } from "./LineItemsEditor";
import { computeLine, computeTotals, applyStockDelta } from "@/lib/calc";
import type { Customer, Supplier, LineItem, Invoice, Quotation, Purchase, CompanySettings, ExtraCharge, AddressSnapshot, BankAccount, TermsTemplate, StructuredTermItem, Party, Receipt } from "@/lib/db";
import { db, nextNumber, uid, getCompany } from "@/lib/db";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { migrateLegacyCustomersAndSuppliersToParties } from "@/modules/accounting/domain/partyResolver";
import { useEffect, useState, useMemo } from "react";
import { useLive } from "@/lib/useLive";
import { toDateInput, fromDateInput, formatDate, formatMoney } from "@/lib/format";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConfirmDialog } from "./ConfirmDialog";
import { Copy, Download, FileText, Pencil, Plus, Printer, Trash2, UserPlus, Truck, HandCoins, Loader2, AlertTriangle } from "lucide-react";
import { ListToolbar, EmptyState, usePagination, Pager } from "./ListHelpers";
import { cn } from "@/lib/utils";
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
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { ref, set, remove as rtdbRemove, onValue } from "firebase/database";
import { removeCachedEntity } from "@/modules/sync/dexieCache";
import { saveDraft, loadDraft, clearDraft } from "@/lib/draftAutosave";
import { reconcileDocumentPostSuccess } from "@/lib/reconciliation";
import { reverseVoucherServerFn } from "@/functions/reverseVoucherFn";
import { freezeQuotationSnapshots } from "@/modules/documents/quotationSnapshot";
import { authoritativeDeleteDraft, authoritativeVoidPosted, authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";

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
  const canonicalParties = useLive<Party>(() => db().parties.orderBy("name").toArray());
  const quotations = useLive<Quotation>(() => kind === "invoice" ? db().quotations.orderBy("createdAt").reverse().toArray() : Promise.resolve([]));
  const bankAccounts = useLive<BankAccount>(() => db().bankAccounts.orderBy("bankName").toArray());
  const termsTemplates = useLive<TermsTemplate>(() => db().termsTemplates.orderBy("name").toArray());

  const { ledgers } = useAccounting();
  const settlementLedgers = useMemo(() => ledgers.filter(l => (l.groupId === "grp_cash" || l.groupId === "grp_bank_accounts") && l.active !== false), [ledgers]);
  const [receiptSettlementLedgerId, setReceiptSettlementLedgerId] = useState<string>("");
  const [receiptPaymentMethod, setReceiptPaymentMethod] = useState<string>("cash");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [openCustomerDrawer, setOpenCustomerDrawer] = useState(false);
  const [openSupplierDrawer, setOpenSupplierDrawer] = useState(false);
  const [openReceiptModal, setOpenReceiptModal] = useState(false);
  const [selectedInvoiceForReceipt, setSelectedInvoiceForReceipt] = useState<Invoice | null>(null);
  const [receiptAmount, setReceiptAmount] = useState<number>(0);
  const [editing, setEditing] = useState<T | null>(null);
  const [preview, setPreview] = useState<T | null>(null);
  const [deleteTargetDoc, setDeleteTargetDoc] = useState<{ doc: T; isPosted: boolean } | null>(null);
  const [isDeletingDoc, setIsDeletingDoc] = useState<boolean>(false);
  const [recoverableDraft, setRecoverableDraft] = useState<{ data: T; savedAt: number } | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);

  // Optimistic row overrides for instant local state sync without waiting for Dexie/Firebase
  const [optimisticOverrides, setOptimisticOverrides] = useState<Map<string, T | null>>(new Map());
  // Active document list filter (PRD § 4: Active (default), Draft, Voided / Deleted, All)
  const [statusFilter, setStatusFilter] = useState<"active" | "draft" | "voided" | "all">("active");

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

  // Customer Advance Tracker (PRD §§ 21-22)
  const customerReceipts = useLive<Receipt>(() => {
    const custId = (editing as any)?.customerId;
    if (!custId) return Promise.resolve([]);
    return db().receipts.where("customerId").equals(custId).toArray();
  }, [(editing as any)?.customerId]);

  const availableCustomerAdvance = useMemo(() => {
    return (customerReceipts || [])
      .filter(r => r.postingStatus !== "reversed" && r.postingStatus !== "refunded")
      .reduce((sum, r) => {
        if (r.advanceAvailablePaise !== undefined) {
          return sum + (r.advanceAvailablePaise / 100);
        }
        if (r.allocationType === "ADVANCE") {
          const allocated = (r.allocatedInvoices || []).reduce((acc, a) => acc + (a.amountPaise / 100), 0);
          return sum + Math.max(0, r.amount - allocated);
        }
        return sum;
      }, 0);
  }, [customerReceipts]);

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

  // Duplicate supplier invoice warning modal state (PRD §§ 58-62)
  const [duplicatePurchaseWarning, setDuplicatePurchaseWarning] = useState<{
    open: boolean;
    supplierName: string;
    invoiceNo: string;
    existingId: string;
    existingNumber: string;
    pendingPurchase: Purchase;
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

    const billSnapshot = (doc as any).billToSnapshot || (doc as any).billingAddressSnapshot;
    const shipSnapshot = (doc as any).shippingAddressSnapshot;
    const shipParty = (doc as any).shipToPartySnapshot;
    const isSame = (doc as any).sameAsBilling !== false;

    return {
      kind: kind as any,
      title: isTaxDoc ? "Tax Invoice" : kind === "invoice" ? "Commercial Invoice" : kind === "quotation" ? "Quotation" : "Purchase Bill",
      number: doc.number,
      date: doc.date,
      dueDate: (doc as Invoice).dueDate,
      company: {
        ...docCompany,
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
        bankAccountHolderName: (docCompany as any).bankAccountHolderName || (docCompany as any).accountHolderName,
        accountHolderName: (docCompany as any).accountHolderName || (docCompany as any).bankAccountHolderName,
        upiId: docCompany.upiId,
        terms: docCompany.terms,
        invoiceTermsMarkdown: (docCompany as any).invoiceTermsMarkdown,
        quotationTermsMarkdown: (docCompany as any).quotationTermsMarkdown,
        showInvoiceTerms: (docCompany as any).showInvoiceTerms,
        showInvoiceBankDetails: (docCompany as any).showInvoiceBankDetails,
        showQuotationTerms: (docCompany as any).showQuotationTerms,
        showQuotationBankDetails: (docCompany as any).showQuotationBankDetails,
        showQuotationGeneralInfo: (docCompany as any).showQuotationGeneralInfo,
        showQuotationTechnicalSpecs: (docCompany as any).showQuotationTechnicalSpecs,
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
        name: billSnapshot?.partyName || party.name,
        company: billSnapshot?.tradingName || party.company,
        address: billSnapshot?.address || (doc as any).billingAddress || party.billingAddress || party.address,
        city: billSnapshot?.city || party.city,
        state: billSnapshot?.state || party.state,
        pincode: billSnapshot?.pincode || party.pincode,
        gstin: billSnapshot?.gstin || party.gstin,
        phone: billSnapshot?.phone || party.mobile || party.phone,
        email: party.email,
        placeOfSupply: billSnapshot?.state || party.state,
        shippingAddress: (doc as any).shippingAddress,
        shipToName: shipParty?.partyName || shipParty?.name || (isSame ? (billSnapshot?.partyName || party.name) : undefined),
        shipToAddress: shipSnapshot?.address || (doc as any).shippingAddress,
        shipToCity: shipSnapshot?.city,
        shipToState: shipSnapshot?.state,
        shipToPincode: shipSnapshot?.pincode,
        shipToGstin: shipParty?.gstin || shipSnapshot?.gstin,
        shipToPhone: shipSnapshot?.phone,
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
      termsSnapshot: (doc as any).termsSnapshot,
      structuredTerms: (doc as any).structuredTerms,
      includeTerms: (doc as any).includeTerms,
      bankAccountId: (doc as any).bankAccountId,
      bankSnapshot: (doc as any).bankSnapshot || (doc as any).bankDetailsSnapshot,
      bankDetailsSnapshot: (doc as any).bankDetailsSnapshot || (doc as any).bankSnapshot,
      includeBankDetails: (doc as any).includeBankDetails,
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

  const parties = useMemo(() => {
    if (tableFor === "customer") {
      const debtors = (canonicalParties || []).filter(p => p.partyType === "SUNDRY_DEBTOR");
      const existingIds = new Set(debtors.map(d => d.id));
      const unmigrated = (customers || []).filter(c => !existingIds.has(c.id));
      return [...debtors, ...unmigrated];
    } else {
      const creditors = (canonicalParties || []).filter(p => p.partyType === "SUNDRY_CREDITOR");
      const existingIds = new Set(creditors.map(c => c.id));
      const unmigrated = (suppliers || []).filter(s => !existingIds.has(s.id));
      return [...creditors, ...unmigrated];
    }
  }, [tableFor, canonicalParties, customers, suppliers]);

  const partyById = (id: string) => {
    if (!id) return undefined;
    return (
      (canonicalParties || []).find(p => p.id === id) ||
      (customers || []).find(c => c.id === id) ||
      (suppliers || []).find(s => s.id === id)
    );
  };

  const effectiveRows: T[] = useMemo(() => {
    const list: T[] = [];
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

    // Prepend newly created items from overrides if not yet emitted by Dexie
    for (const [id, over] of optimisticOverrides.entries()) {
      if (over && !seen.has(id)) {
        list.unshift(over);
      }
    }

    return list;
  }, [rows, optimisticOverrides]);

  const filtered: T[] = useMemo(() => {
    return effectiveRows.filter((r: T) => {
      const docStatus = ((r as any).status || "").toLowerCase();
      const docPosting = ((r as any).postingStatus || "").toLowerCase();
      const isVoidedOrCancelled =
        docStatus === "cancelled" ||
        docStatus === "voided" ||
        docStatus === "deleted" ||
        docPosting === "reversed";
      const isDraft =
        docStatus === "draft" ||
        docPosting === "draft";

      if (statusFilter === "active") {
        if (isVoidedOrCancelled) return false;
      } else if (statusFilter === "draft") {
        if (!isDraft || isVoidedOrCancelled) return false;
      } else if (statusFilter === "voided") {
        if (!isVoidedOrCancelled) return false;
      }
      // "all" includes everything

      if (!q) return true;
      const s = q.toLowerCase().trim();
      const p = partyById((r as any).customerId ?? (r as Purchase).supplierId);
      const suppInv = (r as Purchase).supplierInvoiceNumber?.toLowerCase() ?? "";
      const gstin = p?.gstin?.toLowerCase() ?? "";
      return (
        (r as AnyDoc).number.toLowerCase().includes(s) ||
        (p?.name.toLowerCase().includes(s) ?? false) ||
        gstin.includes(s) ||
        suppInv.includes(s)
      );
    });
  }, [effectiveRows, statusFilter, q, customers, suppliers]);
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
      gstCalculationMode: "overall" as const,
      overallGstRate: 18,
    };
    if (kind === "invoice") {
      setEditing({ ...base, customerId: "", cgstTotal: 0, sgstTotal: 0, igstTotal: 0, isIgst: false, amountPaid: 0, balance: 0, status: "unpaid", gstCalculationMode: "overall", overallGstRate: 18 } as unknown as T);
    } else if (kind === "quotation") {
      setEditing({ ...base, customerId: "", status: "draft", gstCalculationMode: "overall", overallGstRate: 18 } as unknown as T);
    } else {
      setEditing({ ...base, supplierId: "", amountPaid: 0, balance: 0, status: "unpaid" } as unknown as T);
    }
    const saved = loadDraft<T>(kind);
    if (saved && saved.data && (saved.data.items?.length > 0 || (saved.data as any).customerId || (saved.data as Purchase).supplierId)) {
      setRecoverableDraft(saved);
    } else {
      setRecoverableDraft(null);
    }
    setOpen(true);
  }

  // Idempotent migration of legacy customers/suppliers to unified Party Master
  useEffect(() => {
    if (activeCompany?.id) {
      migrateLegacyCustomersAndSuppliersToParties({
        companyId: activeCompany.id,
        uid: user?.uid || "",
      }).catch(console.error);
    }
  }, [activeCompany?.id, user?.uid]);

  function openEdit(r: T) {
    setEditing({ ...r });
    const isDocNonGst = (r as any).gstTotal === 0 && (r as any).cgstTotal === 0 && (r as any).igstTotal === 0 && (r as any).items?.every((it: LineItem) => it.gstRate === 0);
    setEnableGst(!isDocNonGst);
    setOpen(true);
  }

  // Periodic autosave for in-flight document draft (PRD § 50)
  useEffect(() => {
    if (!open || !editing) return;
    const hasContent = (editing.items && editing.items.length > 0) || Boolean((editing as any).customerId) || Boolean((editing as Purchase).supplierId);
    if (hasContent) {
      const timer = setTimeout(() => {
        saveDraft(kind, editing);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [open, editing, kind]);

  // Canonical Realtime Firebase listener for company documents (PRD § 41, 42, 45)
  useEffect(() => {
    if (!activeCompany?.id || !firebaseDb) return;
    const collectionName = kind === "invoice" ? "invoices" : kind === "quotation" ? "quotations" : "purchases";
    const table = kind === "invoice" ? db().invoices : kind === "quotation" ? db().quotations : db().purchases;
    const collectionRef = ref(firebaseDb, `companyData/${activeCompany.id}/${collectionName}`);
    const unsub = onValue(collectionRef, async (snap) => {
      try {
        if (!snap.exists() || !snap.val()) {
          const localRows = await (table as any).toArray();
          if (localRows.length > 0) {
            await (table as any).bulkDelete(localRows.map((r: any) => r.id).filter(Boolean));
          }
          return;
        }
        const val = snap.val();
        const records = Object.values(val) as any[];
        const cloudIds = new Set(records.map((r: any) => r.id));

        const localRows = await (table as any).toArray();
        const toDelete = localRows.filter((r: any) => r.id && !cloudIds.has(r.id)).map((r: any) => r.id);
        if (toDelete.length > 0) {
          await (table as any).bulkDelete(toDelete);
        }
        if (records.length > 0) {
          await (table as any).bulkPut(records);
        }
      } catch (err) {
        console.warn(`[DocumentListPage] Realtime sync warning for ${collectionName}:`, err);
      }
    });
    return () => unsub();
  }, [activeCompany?.id, kind]);

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
      const creditDays = typeof (selectedParty as any)?.creditDays === "number" ? (selectedParty as any).creditDays : 0;
      const baseDate = editing.date || Date.now();
      const dueDate = baseDate + creditDays * 24 * 60 * 60 * 1000;
      setEditing({
        ...editing,
        customerId: selectedPartyId,
        billToPartyId: selectedPartyId,
        shipToPartyId: selectedPartyId,
        isIgst: isInter,
        billingAddress: selectedParty?.address || "",
        shippingAddress: selectedParty?.address || "",
        sameAsBilling: true,
        dueDate,
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

    const totals = computeTotals(editing.items, isIgst, {
      enableGst,
      gstCalculationMode: (editing as any).gstCalculationMode,
      overallGstRate: (editing as any).overallGstRate,
    });
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
      const cust = party as Customer | undefined;

      // Freeze presentation-critical master snapshots (PRD §§ 7-9, 28)
      if (!inv.companySnapshot && activeCompany) {
        inv.companySnapshot = createCompanySnapshot(activeCompany);
      }
      if (!inv.signatorySnapshot && activeCompany) {
        inv.signatorySnapshot = createSignatorySnapshot(activeCompany, inv.signatoryOverride);
      }
      if (inv.includeBankDetails !== false && !inv.bankDetailsSnapshot) {
        const bank = (bankAccounts || []).find(b => b.id === inv.bankAccountId) ||
                     (bankAccounts || []).find(b => b.isDefault) ||
                     (bankAccounts || [])[0];
        if (bank) {
          inv.bankDetailsSnapshot = bank;
          inv.bankSnapshot = bank;
        }
      }
      if (inv.includeTerms !== false && !inv.termsSnapshot && inv.structuredTerms?.length) {
        inv.termsSnapshot = inv.structuredTerms.map(t => t.text);
        inv.structuredTermsSnapshot = inv.structuredTerms;
      }
      const billToSnapshot: AddressSnapshot = inv.billToSnapshot || (inv as any).billingAddressSnapshot || {
        partyName: cust?.name || "",
        tradingName: cust?.tradingName,
        gstin: cust?.gstin,
        pan: cust?.pan,
        address: inv.billingAddress || cust?.billingAddress || cust?.address || "",
        addressLine1: inv.billingAddress || cust?.billingAddress || cust?.address || "",
        city: cust?.city,
        district: cust?.district,
        state: cust?.state,
        stateCode: cust?.stateCode,
        country: cust?.country || "India",
        pincode: cust?.pincode,
        phone: cust?.phone || cust?.mobile,
        contactPerson: cust?.contactPerson,
      };

      const isSameAsBilling = inv.sameAsBilling !== false;
      const shipToPartyId = isSameAsBilling ? inv.customerId : (inv.shipToPartyId || inv.customerId);
      const shipToParty = shipToPartyId ? customers.find(c => c.id === shipToPartyId) || cust : cust;

      const shippingAddressSnapshot: AddressSnapshot = isSameAsBilling
        ? billToSnapshot
        : (inv.shippingAddressSnapshot || {
            partyName: shipToParty?.name || cust?.name || "",
            tradingName: shipToParty?.tradingName,
            gstin: shipToParty?.gstin,
            address: inv.shippingAddress || shipToParty?.billingAddress || shipToParty?.address || "",
            addressLine1: inv.shippingAddress || shipToParty?.billingAddress || shipToParty?.address || "",
            city: shipToParty?.city || cust?.city,
            district: shipToParty?.district,
            state: shipToParty?.state || cust?.state,
            stateCode: shipToParty?.stateCode,
            country: shipToParty?.country || "India",
            pincode: shipToParty?.pincode || cust?.pincode,
            phone: shipToParty?.phone || cust?.phone,
            contactPerson: shipToParty?.contactPerson || cust?.contactPerson,
          });

      inv.billToPartyId = inv.customerId;
      inv.billToSnapshot = billToSnapshot;
      inv.billingAddressSnapshot = billToSnapshot;
      inv.billingAddress = inv.billingAddress || formatAddressLines(billToSnapshot);
      inv.sameAsBilling = isSameAsBilling;
      inv.shipToPartyId = shipToPartyId;
      inv.shipToPartySnapshot = isSameAsBilling ? billToSnapshot : (inv.shipToPartySnapshot || shippingAddressSnapshot);
      inv.shippingAddressId = isSameAsBilling ? inv.billingAddressId : inv.shippingAddressId;
      inv.shippingAddressSnapshot = shippingAddressSnapshot;
      inv.shippingAddress = isSameAsBilling ? (inv.billingAddress || formatAddressLines(billToSnapshot)) : (inv.shippingAddress || formatAddressLines(shippingAddressSnapshot));

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
      inv.postingStatus = "posted";

      const clientMutationId = (inv as any).clientMutationId || uid();
      (inv as any).clientMutationId = clientMutationId;

      const prev = await db().invoices.get(inv.id);
      if (prev) await applyStockDelta(prev.items, 1); // revert old
      await applyStockDelta(inv.items, -1);

      let authoritativeInvoice: Invoice = inv;

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
            clientMutationId,
          });
          if (!res.success) {
            setPostingPhase("idle");
            toast.error(mapFriendlyError(res.error));
            return;
          }
          authoritativeInvoice = (res as any).invoice || inv;
        } else {
          const res = await postInvoiceTransaction({
            companyId: activeCompany.id,
            financialYearId: activeFinancialYear.id,
            invoice: inv,
            company: activeCompany,
            customerLedgerId: custLedger,
            idToken,
            uid: user.uid,
            clientMutationId,
          });
          if (!res.success) {
            setPostingPhase("idle");
            toast.error(mapFriendlyError(res.error));
            return;
          }
          authoritativeInvoice = res.invoice || inv;
        }
      }

      // Immediately upsert returned invoice into Dexie & optimistic React list
      await db().invoices.put(authoritativeInvoice);
      setOptimisticOverrides(prevMap => new Map(prevMap).set(authoritativeInvoice.id, authoritativeInvoice as unknown as T));

      if (activeCompany?.id) {
        reconcileDocumentPostSuccess({
          entityType: "invoice",
          companyId: activeCompany.id,
          document: authoritativeInvoice,
          action: prev ? "update" : "create",
        });
      }

      setPostingPhase("posted");
    } else if (kind === "purchase") {
      const pu = patched as Purchase;
      const suppInv = pu.supplierInvoiceNumber?.trim();
      const policy = (activeCompany as any)?.supplierInvoiceNumberPolicy;
      if (policy === "REQUIRED" && !suppInv) {
        setPostingPhase("idle");
        setSavingDoc(false);
        toast.error("Supplier Invoice Number is required by company policy.");
        return;
      }

      if (suppInv) {
        const norm = suppInv.toLowerCase();
        const existing = (rows as Purchase[]).find(
          p => p.id !== pu.id &&
               p.supplierId === pu.supplierId &&
               p.supplierInvoiceNumber?.trim().toLowerCase() === norm
        );

        if (existing) {
          setPostingPhase("idle");
          setSavingDoc(false);
          setDuplicatePurchaseWarning({
            open: true,
            supplierName: party?.name || "Supplier",
            invoiceNo: suppInv,
            existingId: existing.id,
            existingNumber: existing.number,
            pendingPurchase: pu,
          });
          return;
        }
      }

      pu.balance = Math.max(0, pu.grandTotal - pu.amountPaid);
      pu.status = pu.balance <= 0.01 ? "paid" : pu.amountPaid > 0 ? "partial" : "unpaid";
      pu.postingStatus = "posted";

      const clientMutationId = (pu as any).clientMutationId || uid();
      (pu as any).clientMutationId = clientMutationId;

      const prev = await db().purchases.get(pu.id);
      if (prev) await applyStockDelta(prev.items, -1);
      await applyStockDelta(pu.items, 1);

      let authoritativePurchase: Purchase = pu;

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
          clientMutationId,
        });
        if (!res.success) {
          toast.error(`Posting failed: ${res.error}`);
          return;
        }
        authoritativePurchase = (res as any).purchase || pu;
      }

      await db().purchases.put(authoritativePurchase);
      setOptimisticOverrides(prevMap => new Map(prevMap).set(authoritativePurchase.id, authoritativePurchase as unknown as T));

      if (activeCompany?.id) {
        reconcileDocumentPostSuccess({
          entityType: "purchase",
          companyId: activeCompany.id,
          document: authoritativePurchase,
          action: prev ? "update" : "create",
        });
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

      if (activeCompany?.id) {
        await authoritativeSaveEntity({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear?.id,
          kind: "quotation",
          entity: toSave,
          uid: user?.uid,
          action: rows.find(r => r.id === toSave.id) ? "update" : "create",
        });
      } else {
        await db().quotations.put(toSave);
      }
      setOptimisticOverrides(prevMap => new Map(prevMap).set(toSave.id, toSave as unknown as T));
    }

      clearDraft(kind);
      setRecoverableDraft(null);
      toast.success(kind === "invoice" ? "Invoice posted" : kind === "purchase" ? "Purchase posted" : "Quotation saved");
      setOpen(false);
      setEditing(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to save document");
    } finally {
      setSavingDoc(false);
    }
  }

  async function cancelPostedDoc(doc: T) {
    const id = doc.id;
    // Immediate optimistic exclusion from active list
    const optimisticVoided = {
      ...doc,
      status: "cancelled",
      postingStatus: "reversed",
    };
    setOptimisticOverrides(prevMap => new Map(prevMap).set(id, optimisticVoided as unknown as T));

    try {
      if (activeCompany?.id) {
        let idToken: string | undefined;
        try { idToken = await user?.getIdToken(); } catch {}
        await authoritativeVoidPosted({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear?.id,
          kind: kind as any,
          doc,
          user,
          idToken,
          reversalReason: `${kind === "invoice" ? "Invoice" : "Purchase"} cancelled and voided with reversal accounting`,
        });
      } else {
        await (kind === "invoice" ? db().invoices : db().purchases).put(optimisticVoided as any);
      }

      toast.success(`${kind === "invoice" ? "Invoice" : "Purchase"} voided and removed from active records`);
    } catch (err: any) {
      // Rollback optimistic override on failure
      setOptimisticOverrides(prevMap => {
        const nextMap = new Map(prevMap);
        nextMap.delete(id);
        return nextMap;
      });
      console.error(`[cancelPostedDoc] Failed to void ${kind}:`, err);
      toast.error(err?.message || `Failed to void ${kind}. Record restored.`);
    }
  }

  async function removeDraftDoc(doc: T) {
    const id = doc.id;
    // Immediate optimistic removal
    setOptimisticOverrides(prevMap => new Map(prevMap).set(id, null));

    try {
      if (activeCompany?.id) {
        await authoritativeDeleteDraft({
          companyId: activeCompany.id,
          kind,
          id,
          uid: user?.uid,
          itemsToRevertStock: (doc as any).items,
          stockDeltaDirection: kind === "invoice" ? 1 : -1,
        });
      } else {
        const table = kind === "invoice" ? db().invoices : kind === "quotation" ? db().quotations : db().purchases;
        await table.delete(id);
      }

      toast.success(`${kind === "invoice" ? "Invoice" : kind === "quotation" ? "Quotation" : "Purchase"} deleted`);
    } catch (err: any) {
      // Rollback optimistic removal on failure
      setOptimisticOverrides(prevMap => {
        const nextMap = new Map(prevMap);
        nextMap.delete(id);
        return nextMap;
      });
      console.error(`[removeDraftDoc] Failed to delete ${kind}:`, err);
      toast.error(err?.message || `Failed to delete ${kind}. Record restored.`);
    }
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
    const totals = computeTotals(items, inv.isIgst, {
      enableGst,
      gstCalculationMode: quote.gstCalculationMode,
      overallGstRate: quote.overallGstRate,
    });
    const amountPaid = Number(inv.amountPaid) || 0;
    const extraCharges = quote.extraCharges ? [...quote.extraCharges] : [];
    const extraChargesTotal = extraCharges.reduce((sum, chg) => sum + (Number(chg.amount) || 0), 0);
    const finalGrandTotal = totals.grandTotal + extraChargesTotal;
    setEditing({
      ...editing,
      customerId: quote.customerId,
      customerSnapshot: quote.customerSnapshot,
      billToPartyId: quote.billToPartyId || quote.customerId,
      billToSnapshot: quote.billToSnapshot,
      billingAddressId: quote.billingAddressId,
      billingAddressSnapshot: quote.billingAddressSnapshot,
      billingAddress: quote.billingAddress,
      sameAsBilling: quote.sameAsBilling !== false,
      shipToPartyId: quote.shipToPartyId || quote.customerId,
      shipToPartySnapshot: quote.shipToPartySnapshot,
      shippingAddressId: quote.shippingAddressId,
      shippingAddressSnapshot: quote.shippingAddressSnapshot,
      shippingAddress: quote.shippingAddress,
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
      termsSnapshot: quote.termsSnapshot,
      structuredTermsSnapshot: quote.structuredTermsSnapshot,
      includeTerms: quote.includeTerms !== false,
      bankAccountId: quote.bankAccountId,
      bankSnapshot: quote.bankSnapshot,
      bankDetailsSnapshot: quote.bankDetailsSnapshot || quote.bankSnapshot,
      includeBankDetails: quote.includeBankDetails !== false,
      gstCalculationMode: quote.gstCalculationMode || "item_wise",
      overallGstRate: quote.overallGstRate,
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
      const targetSettlementLedger = receiptSettlementLedgerId || defaultCash;

      const receiptRecord = {
        id: uid(),
        number,
        date: Date.now(),
        customerId: selectedInvoiceForReceipt.customerId,
        invoiceId: selectedInvoiceForReceipt.id,
        amount: receiptAmount,
        mode: (receiptPaymentMethod === "cash" ? "cash" : "bank") as "cash" | "bank",
        paymentMethod: receiptPaymentMethod,
        settlementLedgerId: targetSettlementLedger,
        createdAt: Date.now(),
      };

      if (activeCompany?.id && activeFinancialYear?.id && user) {
        await postReceiptTransaction({
          companyId: activeCompany.id,
          financialYearId: activeFinancialYear.id,
          receipt: receiptRecord,
          customerLedgerId,
          settlementLedgerId: targetSettlementLedger,
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
        <div className="animate-fade-in space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center rounded-lg bg-muted/60 p-1 text-xs">
              <button
                type="button"
                onClick={() => setStatusFilter("active")}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-all",
                  statusFilter === "active" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("draft")}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-all",
                  statusFilter === "draft" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Draft
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("voided")}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-all",
                  statusFilter === "voided" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                Voided / Deleted
              </button>
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={cn(
                  "rounded-md px-3 py-1.5 font-medium transition-all",
                  statusFilter === "all" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                All
              </button>
            </div>
          </div>
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
                      <TableHead>{kind === "purchase" ? "BMS Purchase #" : "Number"}</TableHead>
                      {kind === "purchase" && <TableHead>Supplier Invoice #</TableHead>}
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
                          {kind === "purchase" && (
                            <TableCell className="font-mono font-semibold text-primary">
                              {(r as Purchase).supplierInvoiceNumber || "—"}
                            </TableCell>
                          )}
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
                            {(() => {
                              const docStatus = ((r as any).status || "").toLowerCase();
                              const docPosting = ((r as any).postingStatus || "").toLowerCase();
                              const isVoidedOrCancelled =
                                docStatus === "cancelled" ||
                                docStatus === "voided" ||
                                docStatus === "deleted" ||
                                docPosting === "reversed";
                              const isDraft =
                                docStatus === "draft" ||
                                docPosting === "draft";

                              if (isVoidedOrCancelled) {
                                return (
                                  <span className="rounded-md bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 text-[10px] uppercase font-semibold">
                                    Deleted / Voided
                                  </span>
                                );
                              }
                              if (isDraft) {
                                return (
                                  <span className="rounded-md bg-amber-500/10 text-amber-600 border border-amber-500/20 px-2 py-0.5 text-[10px] uppercase font-semibold">
                                    Draft
                                  </span>
                                );
                              }
                              return (
                                <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10px] uppercase font-semibold">
                                  {(r as unknown as Invoice).status}
                                </span>
                              );
                            })()}
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
                              <Button
                                size="icon"
                                variant="ghost"
                                title={
                                  kind === "invoice" && (r as unknown as Invoice).postingStatus === "posted"
                                    ? "Delete Invoice"
                                    : kind === "purchase" && (r as unknown as Purchase).postingStatus === "posted"
                                    ? "Delete Purchase"
                                    : "Delete Draft"
                                }
                                onClick={() => {
                                  const isPosted =
                                    kind === "invoice"
                                      ? (r as unknown as Invoice).postingStatus === "posted"
                                      : kind === "purchase"
                                      ? (r as unknown as Purchase).postingStatus === "posted"
                                      : false;
                                  setDeleteTargetDoc({ doc: r, isPosted });
                                }}
                              >
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
            <DialogTitle className="flex items-center justify-between gap-3 text-base pr-8 sm:pr-10">
              <span>{editing && rows.find(r => r.id === editing.id) ? `Edit ${title.slice(0, -1)}` : `New ${title.slice(0, -1)}`}</span>
              {kind === "invoice" && (
                <div className="flex items-center gap-2 text-xs font-normal shrink-0">
                  <span className="text-muted-foreground hidden xs:inline">GST Mode:</span>
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
              {kind === "invoice" && (
                <div className="space-y-4">
                  {/* Bill To & Ship To Side-by-Side Cards */}
                  <div className="grid gap-4 md:grid-cols-2">
                    {/* BILL TO */}
                    <Card className="p-3.5 space-y-2.5 border-border/70 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-1.5">
                        <div className="text-xs font-bold uppercase tracking-wider text-primary">
                          BILL TO (Customer / Sundry Debtor)
                        </div>
                        {(editing as any).customerId && (
                          <button
                            type="button"
                            onClick={() => setInsightCustomerId((editing as any).customerId)}
                            className="text-[11px] text-primary hover:underline font-medium"
                          >
                            Financial History
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Customer *</Label>
                        <PartySearchSelect
                          type="customer"
                          value={(editing as any).customerId || ""}
                          parties={parties}
                          onChange={(id: string) => onPartySelect(id)}
                          onAddNew={() => setOpenCustomerDrawer(true)}
                        />
                      </div>
                      <div className="space-y-1">
                        <PartyAddressSelect
                          party={partyById((editing as any).customerId)}
                          selectedAddressId={(editing as any).billingAddressId}
                          onChange={(snapshot, addressId) => {
                            setEditing(prev => {
                              if (!prev) return prev;
                              const formatted = formatAddressLines(snapshot);
                              const isSame = (prev as any).sameAsBilling !== false;
                              return {
                                ...prev,
                                billingAddressId: addressId,
                                billingAddressSnapshot: snapshot,
                                billingAddress: formatted,
                                ...(isSame ? {
                                  shippingAddressId: addressId,
                                  shippingAddressSnapshot: snapshot,
                                  shippingAddress: formatted,
                                } : {}),
                              } as T;
                            });
                          }}
                          label="Billing Address (Saved Party Master)"
                        />
                      </div>
                    </Card>

                    {/* SHIP TO */}
                    <Card className="p-3.5 space-y-2.5 border-border/70 shadow-xs">
                      <div className="flex items-center justify-between border-b pb-1.5">
                        <div className="text-xs font-bold uppercase tracking-wider text-primary">
                          SHIP TO (Delivery Destination / Consignee)
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="inv-same-as-billing"
                            checked={(editing as any).sameAsBilling !== false}
                            onCheckedChange={(checked) => {
                              const isChecked = checked === true;
                              setEditing(prev => {
                                if (!prev) return prev;
                                const billSnapshot = (prev as any).billingAddressSnapshot;
                                const billAddr = (prev as any).billingAddress;
                                return {
                                  ...prev,
                                  sameAsBilling: isChecked,
                                  ...(isChecked ? {
                                    shipToPartyId: (prev as any).customerId,
                                    shippingAddressId: (prev as any).billingAddressId,
                                    shippingAddressSnapshot: billSnapshot,
                                    shippingAddress: billAddr,
                                  } : {}),
                                } as T;
                              });
                            }}
                          />
                          <Label htmlFor="inv-same-as-billing" className="text-xs cursor-pointer select-none font-medium">
                            Same as Billing Address
                          </Label>
                        </div>
                      </div>

                      {(editing as any).sameAsBilling !== false ? (
                        <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-3.5 text-center text-xs text-muted-foreground leading-relaxed">
                          <p className="font-medium text-foreground mb-0.5">Shipping destination is identical to Billing Address.</p>
                          <p className="text-[11px]">Uncheck to select a different delivery destination, site address, or consignee.</p>
                          {(editing as any).billingAddress && (
                            <div className="mt-2 rounded border border-border/50 bg-background/80 p-2 text-left text-[11px] font-mono text-muted-foreground whitespace-pre-line">
                              {(editing as any).billingAddress}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          <div className="space-y-1">
                            <Label className="text-xs font-medium">Ship To Party / Consignee</Label>
                            <PartySearchSelect
                              type="customer"
                              value={(editing as any).shipToPartyId || (editing as any).customerId || ""}
                              parties={parties}
                              onChange={(id: string) => {
                                const p = customers.find(c => c.id === id);
                                setEditing(prev => ({
                                  ...prev,
                                  shipToPartyId: id,
                                  shipToPartySnapshot: p ? {
                                    partyName: p.name,
                                    tradingName: p.tradingName,
                                    gstin: p.gstin,
                                    address: p.billingAddress || p.address,
                                    city: p.city,
                                    state: p.state,
                                    country: p.country,
                                    pincode: p.pincode,
                                    phone: p.phone,
                                  } : undefined,
                                } as T));
                              }}
                              onAddNew={() => setOpenCustomerDrawer(true)}
                            />
                          </div>
                          <div className="space-y-1">
                            <PartyAddressSelect
                              party={customers.find(c => c.id === ((editing as any).shipToPartyId || (editing as any).customerId))}
                              selectedAddressId={(editing as any).shippingAddressId}
                              onChange={(snapshot, addressId) => {
                                setEditing(prev => ({
                                  ...prev,
                                  shippingAddressId: addressId,
                                  shippingAddressSnapshot: snapshot,
                                  shippingAddress: formatAddressLines(snapshot),
                                } as T));
                              }}
                              label="Shipping / Site Destination (Saved Party Master)"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Custom Shipping / Site Address Details</Label>
                            <Textarea
                              rows={2}
                              value={(editing as unknown as Invoice).shippingAddress || ""}
                              onChange={e => setEditing({ ...editing, shippingAddress: e.target.value } as T)}
                              placeholder="Site / delivery address, gate no, contact person at site…"
                              className="text-xs"
                            />
                          </div>
                        </div>
                      )}
                    </Card>
                  </div>

                  {(editing as any).customerId && (
                    <InvoicePartyStatusPanel
                      party={partyById((editing as any).customerId) as any}
                      invoiceTotal={
                        computeTotals(editing.items, Boolean((editing as any).isIgst), { enableGst }).grandTotal +
                        ((editing as any).extraChargesTotal || 0)
                      }
                      onRecordReceipt={(_p, deficit) => {
                        setSelectedInvoiceForReceipt(null);
                        setReceiptAmount(deficit > 0 ? deficit : 0);
                        setOpenReceiptModal(true);
                      }}
                    />
                  )}

                  {/* Document Parameters Grid */}
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                    <div className="space-y-1">
                      <Label className="text-xs">Invoice Number</Label>
                      <Input value={editing.number} readOnly className="font-mono text-xs bg-muted/30" />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Invoice Date</Label>
                      <Input
                        type="date"
                        value={toDateInput(editing.date)}
                        onChange={e => {
                          const newDate = fromDateInput(e.target.value);
                          const cust = partyById((editing as any).customerId);
                          const creditDays = typeof (cust as any)?.creditDays === "number" ? (cust as any).creditDays : 0;
                          setEditing({
                            ...editing,
                            date: newDate,
                            dueDate: newDate + creditDays * 24 * 60 * 60 * 1000,
                          } as T);
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Due Date</Label>
                        {partyById((editing as any).customerId) && (
                          <span className="text-[10px] text-muted-foreground">
                            {((partyById((editing as any).customerId) as any)?.creditDays === 0) ? "Immediate (0d)" : `${(partyById((editing as any).customerId) as any)?.creditDays || 0}d terms`}
                          </span>
                        )}
                      </div>
                      <Input
                        type="date"
                        value={toDateInput((editing as unknown as Invoice).dueDate)}
                        onChange={e => setEditing({ ...editing, dueDate: fromDateInput(e.target.value) } as T)}
                      />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs">Available Advance</Label>
                        <span className="font-mono font-bold text-xs text-emerald-600">
                          {formatMoney(availableCustomerAdvance)}
                        </span>
                      </div>
                      <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-1.5 text-[11px] text-muted-foreground flex items-center justify-between">
                        <span>
                          {availableCustomerAdvance > 0
                            ? `Customer has ${formatMoney(availableCustomerAdvance)} advance available`
                            : "No unallocated advance"}
                        </span>
                        {availableCustomerAdvance > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            Apply via Receipt
                          </span>
                        )}
                      </div>
                    </div>
                    {enableGst && (
                      <div className="space-y-2 sm:col-span-2 rounded-lg border border-border/60 bg-muted/20 p-2.5">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold">Tax Supply Determination</Label>
                            <Select value={(editing as unknown as Invoice).isIgst ? "igst" : "cgst"} onValueChange={v => setEditing({ ...editing, isIgst: v === "igst" } as T)}>
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="cgst">Intra-State: CGST + SGST</SelectItem>
                                <SelectItem value="igst">Inter-State: IGST</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs font-semibold">GST Mode</Label>
                            <Select
                              value={(editing as any).gstCalculationMode || "overall"}
                              onValueChange={v => setEditing({ ...editing, gstCalculationMode: v } as T)}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="overall">Overall GST Rate</SelectItem>
                                <SelectItem value="item_wise">Item-wise GST</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          {((editing as any).gstCalculationMode !== "item_wise") && (
                            <div className="space-y-1">
                              <Label className="text-xs font-semibold">Overall GST Rate</Label>
                              <Select
                                value={String((editing as any).overallGstRate ?? 18)}
                                onValueChange={v => setEditing({ ...editing, overallGstRate: Number(v) } as T)}
                              >
                                <SelectTrigger className="h-8 text-xs font-mono font-bold"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="0">0% (Nil / Exempt)</SelectItem>
                                  <SelectItem value="5">5% GST</SelectItem>
                                  <SelectItem value="12">12% GST</SelectItem>
                                  <SelectItem value="18">18% GST (Standard)</SelectItem>
                                  <SelectItem value="28">28% GST</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="space-y-1 sm:col-span-2">
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
                  </div>
                </div>
              )}

              {kind === "purchase" && (
                <div className="space-y-4">
                  <Card className="p-4 border-border/70 shadow-xs space-y-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-primary border-b pb-2">
                      PURCHASE & SUPPLIER DETAILS
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs font-medium">Supplier (Sundry Creditor) *</Label>
                          {(editing as Purchase).supplierId && (
                            <button
                              type="button"
                              onClick={() => setInsightSupplierId((editing as Purchase).supplierId)}
                              className="text-[11px] text-primary hover:underline flex items-center gap-1 font-medium"
                            >
                              <FileText className="h-3 w-3" /> Supplier History
                            </button>
                          )}
                        </div>
                        <PartySearchSelect
                          type="supplier"
                          value={(editing as Purchase).supplierId || ""}
                          parties={parties}
                          onChange={(id: string) => onPartySelect(id)}
                          onAddNew={() => setOpenSupplierDrawer(true)}
                        />
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">
                          Supplier Invoice No.
                          {((activeCompany as any)?.supplierInvoiceNumberPolicy === "REQUIRED") && <span className="text-destructive"> *</span>}
                        </Label>
                        <Input
                          placeholder="e.g. INV-87945"
                          value={(editing as Purchase).supplierInvoiceNumber || ""}
                          onChange={e => setEditing({ ...editing, supplierInvoiceNumber: e.target.value } as T)}
                          className="font-mono text-xs"
                        />
                        <p className="text-[10px] text-muted-foreground">Original invoice number from vendor bill</p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Supplier Invoice Date</Label>
                        <Input
                          type="date"
                          value={toDateInput((editing as Purchase).supplierInvoiceDate)}
                          onChange={e => setEditing({ ...editing, supplierInvoiceDate: fromDateInput(e.target.value) } as T)}
                        />
                        <p className="text-[10px] text-muted-foreground">Date printed on supplier's invoice</p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">BMS Purchase No.</Label>
                        <Input value={editing.number} readOnly className="font-mono text-xs bg-muted/30" />
                        <p className="text-[10px] text-muted-foreground">Internal atomic BMS reference</p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Purchase Entry Date</Label>
                        <Input
                          type="date"
                          value={toDateInput(editing.date)}
                          onChange={e => setEditing({ ...editing, date: fromDateInput(e.target.value) })}
                        />
                        <p className="text-[10px] text-muted-foreground">Date entered into accounts</p>
                      </div>

                      <div className="space-y-1">
                        <Label className="text-xs font-medium">Payment Settlement</Label>
                        <div className="rounded-md border bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
                          Supplier payments are recorded via <strong className="text-foreground">Payment Vouchers</strong>.
                        </div>
                      </div>

                      <div className="space-y-1 sm:col-span-2 md:col-span-3">
                        <PartyAddressSelect
                          party={partyById((editing as Purchase).supplierId)}
                          selectedAddressId={(editing as any).billingAddressId}
                          onChange={(snapshot, addressId) => {
                            setEditing({
                              ...editing,
                              billingAddressId: addressId,
                              billingAddressSnapshot: snapshot,
                              billingAddress: formatAddressLines(snapshot),
                            } as T);
                          }}
                          label="Supplier Address (Saved Party Master)"
                        />
                      </div>
                    </div>
                  </Card>
                </div>
              )}

              {kind === "quotation" && (
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
                    <Label className="text-xs">Customer *</Label>
                    <PartySearchSelect
                      type="customer"
                      value={(editing as any).customerId || ""}
                      parties={parties}
                      onChange={(id: string) => onPartySelect(id)}
                      onAddNew={() => setOpenCustomerDrawer(true)}
                    />
                  </div>
                  <div className="space-y-1 sm:col-span-3">
                    <PartyAddressSelect
                      party={partyById((editing as any).customerId)}
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
                      label="Customer Billing Address (Saved Party Master)"
                    />
                  </div>
                </div>
              )}

              {/* Line Items Editor */}
              <LineItemsEditor
                items={editing.items}
                onChange={(items) => setEditing({ ...editing, items } as T)}
                mode={kind === "purchase" ? "purchase" : "sales"}
                isIgst={kind === "invoice" ? (editing as unknown as Invoice).isIgst : false}
                enableGst={enableGst}
                gstCalculationMode={(editing as any).gstCalculationMode || (kind === "purchase" ? "item_wise" : "overall")}
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
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                  <div>
                    <div className="text-xs font-semibold text-foreground">Terms & Bank Details: Managed in Company Settings</div>
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Invoice Terms & Conditions and Bank Settlement Details are centrally managed and automatically included based on company defaults.
                    </div>
                  </div>
                  <Button variant="outline" size="sm" asChild className="text-xs shrink-0">
                    <a href="/settings" target="_blank" rel="noreferrer">Company Settings</a>
                  </Button>
                </div>
              )}

              <div className="space-y-1">
                <Label className="text-xs">Notes {kind === "invoice" ? "& Remarks" : "& Payment Terms"}</Label>
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
            <DialogTitle className="flex items-center justify-between gap-2 pr-8 sm:pr-10">
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
                    const normDoc = getNormalizedDoc(preview);
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
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Received Into (Ledger)</Label>
                  <Select value={receiptSettlementLedgerId} onValueChange={setReceiptSettlementLedgerId}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Default Cash" /></SelectTrigger>
                    <SelectContent>
                      {settlementLedgers.map((l) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.groupId === "grp_cash" ? "Cash" : "Bank"})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Payment Method</Label>
                  <Select value={receiptPaymentMethod} onValueChange={setReceiptPaymentMethod}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer / NEFT</SelectItem>
                      <SelectItem value="upi">UPI</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
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

                let finalSaved = inv;
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
                  finalSaved = (res as any).invoice || inv;
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
                  finalSaved = res.invoice || inv;
                }
                await db().invoices.put(finalSaved);
                setOptimisticOverrides(prevMap => new Map(prevMap).set(finalSaved.id, finalSaved as unknown as T));
                reconcileDocumentPostSuccess({
                  entityType: "invoice",
                  companyId: activeCompany.id,
                  document: finalSaved,
                  action: prev ? "update" : "create",
                });
              } else {
                await db().invoices.put(inv);
                setOptimisticOverrides(prevMap => new Map(prevMap).set(inv.id, inv as unknown as T));
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

      {/* Duplicate Supplier Invoice Warning Modal (PRD §§ 58-62) */}
      <Dialog
        open={Boolean(duplicatePurchaseWarning?.open)}
        onOpenChange={(o) => !o && setDuplicatePurchaseWarning(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              Duplicate Supplier Invoice Detected
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2 text-xs">
            <p className="text-slate-700 leading-relaxed">
              Supplier Invoice <strong className="font-mono font-bold text-foreground">"{duplicatePurchaseWarning?.invoiceNo}"</strong> has already been recorded for <strong className="text-foreground">{duplicatePurchaseWarning?.supplierName}</strong> in BMS Purchase <strong className="font-mono">{duplicatePurchaseWarning?.existingNumber}</strong>.
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] text-amber-800 leading-relaxed">
              To prevent double-counting expenses, payables, or input tax credit, please verify whether this purchase bill was already recorded.
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDuplicatePurchaseWarning(null)}
              className="text-xs"
            >
              Review Invoice No.
            </Button>
            <Button
              variant="default"
              onClick={() => {
                const existingId = duplicatePurchaseWarning?.existingId;
                setDuplicatePurchaseWarning(null);
                setOpen(false);
                const target = (rows as Purchase[]).find(p => p.id === existingId);
                if (target) setPreview(target as unknown as T);
              }}
              className="text-xs"
            >
              Open Existing Purchase
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={Boolean(deleteTargetDoc)}
        onOpenChange={(o) => !o && setDeleteTargetDoc(null)}
        title={
          deleteTargetDoc?.isPosted
            ? `Delete ${kind === "invoice" ? "Invoice" : "Purchase"} "${deleteTargetDoc?.doc.number}"?`
            : `Delete Draft ${kind === "invoice" ? "Invoice" : kind === "quotation" ? "Quotation" : "Purchase"} "${deleteTargetDoc?.doc.number}"?`
        }
        description={
          deleteTargetDoc?.isPosted
            ? `This posted ${kind === "invoice" ? "invoice" : "purchase"} will be removed from the active list and voided with reversal accounting. Audit history will be retained.`
            : `This draft document has not been posted to accounting ledgers and will be permanently removed.`
        }
        destructive={true}
        confirmText={deleteTargetDoc?.isPosted ? `Delete ${kind === "invoice" ? "Invoice" : "Purchase"}` : "Delete Draft"}
        busyText={deleteTargetDoc?.isPosted ? "Voiding…" : "Deleting…"}
        onConfirm={async () => {
          if (!deleteTargetDoc) return;
          if (deleteTargetDoc.isPosted) {
            await cancelPostedDoc(deleteTargetDoc.doc);
          } else {
            await removeDraftDoc(deleteTargetDoc.doc);
          }
          setDeleteTargetDoc(null);
        }}
      />
    </>
  );
}
