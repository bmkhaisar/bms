import { useEffect, useState, useRef, useMemo } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Eye, Download, Printer, Pencil, FileCheck, ExternalLink,
  Loader2, Share2, RotateCcw, AlertTriangle, RefreshCw, AlertCircle
} from "lucide-react";
import { db, type Quotation, type Customer, type CompanySettings, type QuotationTemplate } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useLive } from "@/lib/useLive";
import { downloadQuotationPDF, printQuotationPDF, exportQuotationPDF, triggerDownload } from "@/lib/quotationExport";
import { resolveEffectiveCompany, isDocumentFinalized, resolveCanonicalBankDetails } from "@/lib/documentModel";
import { createCompanySnapshot } from "@/modules/company/types";
import { authoritativeSaveEntity } from "@/modules/sync/canonicalMutationService";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface QuotationQuickPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quotation: Quotation | null;
  onEdit?: (q: Quotation) => void;
  onConvert?: (q: Quotation) => void;
  onShare?: (q: Quotation) => void;
}

/**
 * QuotationQuickPreviewModal
 * 
 * Production Vector PDF Preview Engine (PRD §§ 8-10, 60, Correction #1, #27):
 * Renders the actual generated vector PDF directly in an iframe/viewer so that:
 * 
 *                 Preview === Downloaded PDF === Print
 * 
 * Features:
 * - Robust cancellation and 10s timeout protection against infinite spinner.
 * - Primitive useEffect dependencies preventing render-cancel infinite loops.
 * - Error state with direct Retry Preview and fallback download.
 * - Direct reuse of the generated PDF Blob across Preview, Download, and Print.
 * - Explicit Historical Snapshot detection and controlled Reissue action for quotations.
 */
export function QuotationQuickPreviewModal({
  open,
  onOpenChange,
  quotation,
  onEdit,
  onConvert,
  onShare,
}: QuotationQuickPreviewModalProps) {
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const { user } = useAuth();
  const customers = useLive<Customer>(() => db().customers.toArray());
  const companySettingsList = useLive<CompanySettings>(() => db().companySettings.toArray());
  const templates = useLive<QuotationTemplate>(() => db().quotationTemplates.toArray());
  const companySettings = useMemo(() => {
    if (!companySettingsList || companySettingsList.length === 0) return undefined;
    if (activeCompany?.id) {
      const match = companySettingsList.find((c) => c.id === activeCompany.id);
      if (match) return match;
    }
    const singleton = companySettingsList.find((c) => c.id === "singleton");
    if (singleton) return singleton;
    return companySettingsList[0];
  }, [companySettingsList, activeCompany?.id]);

  const [currentQuotation, setCurrentQuotation] = useState<Quotation | null>(quotation);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [settingsRev, setSettingsRev] = useState(0);
  const [isReissuing, setIsReissuing] = useState(false);
  const prevBlobUrlRef = useRef<string | null>(null);

  // Sync internal quotation state when prop changes, invalidating any previous PDF blob immediately
  useEffect(() => {
    setCurrentQuotation(quotation);
    if (prevBlobUrlRef.current) {
      URL.revokeObjectURL(prevBlobUrlRef.current);
      prevBlobUrlRef.current = null;
    }
    setPdfUrl(null);
    setPdfBlob(null);
    setError(null);
  }, [quotation?.id, quotation?.number]);

  // Memoize resolved company, customer and template
  const comp = useMemo(
    () => resolveEffectiveCompany(currentQuotation, activeCompany, companySettings),
    [currentQuotation, activeCompany, companySettings]
  );

  const cust = useMemo(
    () => currentQuotation?.customerSnapshot || (customers ? customers.find((c) => c.id === currentQuotation?.customerId) : undefined),
    [currentQuotation?.customerSnapshot, currentQuotation?.customerId, customers]
  );

  const template = useMemo(
    () => (currentQuotation?.templateId ? templates.find((t) => t.id === currentQuotation.templateId) : undefined),
    [currentQuotation?.templateId, templates]
  );

  // Listen for realtime / cross-tab company settings updates
  useEffect(() => {
    const handleUpdate = () => setSettingsRev((r) => r + 1);
    window.addEventListener("bms:company-settings-updated", handleUpdate);
    return () => window.removeEventListener("bms:company-settings-updated", handleUpdate);
  }, []);

  // Check if document is frozen to an older historical company profile
  const isFinalized = isDocumentFinalized(currentQuotation);
  const snapName = currentQuotation?.companySnapshot?.name || currentQuotation?.companySnapshot?.legalName;
  const activeName = activeCompany?.name || activeCompany?.legalName;
  const isSnapshotStale = Boolean(
    isFinalized &&
    snapName &&
    activeName &&
    snapName.trim().toLowerCase() !== activeName.trim().toLowerCase()
  );

  // Controlled Reissue handler: update quotation's company snapshot to latest active company profile
  async function handleReissueWithLatestCompany() {
    if (!currentQuotation || !activeCompany) return;
    setIsReissuing(true);
    try {
      const updatedSnapshot = createCompanySnapshot(activeCompany);
      const bankAccounts = await db().bankAccounts.toArray();
      const canonicalBank = resolveCanonicalBankDetails(currentQuotation, activeCompany, isFinalized);

      const updatedQuotation: Quotation = {
        ...currentQuotation,
        companySnapshot: updatedSnapshot,
        updatedAt: Date.now(),
      };

      if (canonicalBank?.bankDetails) {
        (updatedQuotation as any).bankSnapshot = canonicalBank.bankDetails;
      }

      // Persist to Cloud and Dexie
      if (activeCompany?.id) {
        await authoritativeSaveEntity({
          companyId: activeCompany.id,
          financialYearId: updatedQuotation.financialYearId || activeFinancialYear?.id,
          kind: "quotation",
          entity: updatedQuotation,
          uid: user?.uid,
          action: "update",
        });
      } else {
        await db().quotations.put(updatedQuotation);
      }

      setCurrentQuotation(updatedQuotation);
      window.dispatchEvent(
        new CustomEvent("bms:company-settings-updated", {
          detail: { companyId: activeCompany.id, company: activeCompany },
        })
      );
      toast.success(`Quotation updated with ${activeName}`);
      setRetryCount((c) => c + 1);
    } catch (err: any) {
      console.error("Failed to update quotation company snapshot:", err);
      toast.error(err?.message || "Failed to update quotation company profile");
    } finally {
      setIsReissuing(false);
    }
  }

  // Effect to generate vector PDF blob using primitive dependency keys
  useEffect(() => {
    if (!open || !currentQuotation) {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
      setPdfUrl(null);
      setPdfBlob(null);
      setLoading(false);
      setError(null);
      return;
    }

    let isCancelled = false;
    setLoading(true);
    setError(null);

    // 10-second failsafe timeout to prevent infinite spinner
    const timeoutTimer = setTimeout(() => {
      if (isCancelled) return;
      setLoading(false);
      setError("Preview generation timed out after 10 seconds. You can retry or download directly.");
    }, 10000);

    const debounceTimer = setTimeout(async () => {
      try {
        const blob = await exportQuotationPDF(currentQuotation, comp as any, cust as any, template);
        if (isCancelled) return;
        clearTimeout(timeoutTimer);

        if (prevBlobUrlRef.current) {
          URL.revokeObjectURL(prevBlobUrlRef.current);
        }

        const url = URL.createObjectURL(blob);
        prevBlobUrlRef.current = url;
        setPdfBlob(blob);
        setPdfUrl(url);
        setError(null);
      } catch (err: any) {
        console.error("Failed to render PDF preview:", err);
        if (!isCancelled) {
          clearTimeout(timeoutTimer);
          setError(err?.message || "Failed to generate preview PDF.");
        }
      } finally {
        if (!isCancelled) {
          clearTimeout(timeoutTimer);
          setLoading(false);
        }
      }
    }, 120);

    return () => {
      isCancelled = true;
      clearTimeout(debounceTimer);
      clearTimeout(timeoutTimer);
    };
  }, [
    open,
    currentQuotation?.id,
    currentQuotation?.updatedAt,
    currentQuotation?.status,
    comp?.name,
    comp?.legalName,
    comp?.address,
    comp?.gstin,
    comp?.logo,
    comp?.bankAccountNo,
    comp?.bankIfsc,
    cust?.name,
    template?.id,
    settingsRev,
    retryCount,
  ]);

  // Clean up object URL on component unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
    };
  }, []);

  if (!currentQuotation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[94vh] max-h-[94vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header with Title & Quick Controls */}
        <DialogHeader className="p-3.5 border-b bg-muted/20 flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-primary" />
            Quotation Preview — {currentQuotation.number}
            <Badge variant="outline" className="ml-2 uppercase text-[10px]">
              {currentQuotation.status}
            </Badge>
            {currentQuotation.gstCalculationMode === "overall" && (
              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                Overall GST {currentQuotation.overallGstRate ?? 18}%
              </Badge>
            )}
          </DialogTitle>

          <div className="flex items-center gap-2 pr-6">
            {pdfUrl && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => window.open(pdfUrl, "_blank")}
                title="Open in new window"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">New Tab</span>
              </Button>
            )}
          </div>
        </DialogHeader>

        {/* Historical Snapshot Notice with Controlled Reissue Option */}
        {isSnapshotStale && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Historical Snapshot:</strong> This quotation is locked to historical profile (<strong>{snapName}</strong>). Active company is <strong>{activeName}</strong>.
              </span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs bg-white dark:bg-amber-900/50 border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900 gap-1.5 font-medium"
              onClick={handleReissueWithLatestCompany}
              disabled={isReissuing}
            >
              <RefreshCw className={cn("h-3 w-3", isReissuing && "animate-spin")} />
              Update to {activeName}
            </Button>
          </div>
        )}

        {/* Multi-Page Vector PDF Viewport (Preview === Downloaded PDF) */}
        <div className="flex-1 w-full h-full min-h-0 bg-slate-100 dark:bg-slate-900 flex items-center justify-center relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">Preparing Preview…</div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Generating vector PDF pages with complete address, terms, specifications & bank details
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="text-center p-8 max-w-md bg-card rounded-xl shadow-sm border m-4">
              <AlertCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <div className="text-destructive font-bold text-base mb-1">Preview Generation Failed</div>
              <div className="text-xs text-muted-foreground mb-5">{error}</div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => {
                    setError(null);
                    setRetryCount((c) => c + 1);
                  }}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Retry Preview
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (comp) downloadQuotationPDF(currentQuotation, comp as any, cust as any, template, pdfBlob);
                  }}
                  className="gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> Download PDF Instead
                </Button>
              </div>
            </div>
          )}

          {pdfUrl && !loading && (
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
              className="w-full h-full border-0 bg-white dark:bg-slate-950 shadow-inner"
              title={`Quotation Preview - ${currentQuotation.number}`}
            />
          )}
        </div>

        {/* Modal Actions Footer */}
        <DialogFooter className="p-3 border-t bg-muted/20 flex flex-wrap items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          <div className="flex items-center gap-2">
            {onEdit && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  onOpenChange(false);
                  onEdit(currentQuotation);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit Quotation
              </Button>
            )}

            {onConvert && currentQuotation.status !== "converted" && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 text-primary border border-primary/20"
                onClick={() => {
                  onOpenChange(false);
                  onConvert(currentQuotation);
                }}
              >
                <FileCheck className="h-3.5 w-3.5" /> Convert to Invoice
              </Button>
            )}

            {onShare && (
              <Button
                variant="outline"
                size="sm"
                className="gap-1.5 text-primary border-primary/30 hover:bg-primary/5"
                onClick={() => {
                  onOpenChange(false);
                  onShare(currentQuotation);
                }}
              >
                <Share2 className="h-3.5 w-3.5" /> Share
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={loading}
              onClick={() => {
                if (pdfUrl) {
                  const iframe = document.createElement("iframe");
                  iframe.style.display = "none";
                  iframe.src = pdfUrl;
                  document.body.appendChild(iframe);
                  iframe.onload = () => {
                    iframe.contentWindow?.print();
                    setTimeout(() => {
                      if (document.body.contains(iframe)) document.body.removeChild(iframe);
                    }, 60000);
                  };
                } else if (comp && currentQuotation) {
                  printQuotationPDF(currentQuotation, comp as any, cust as any, template, pdfBlob);
                }
              }}
            >
              <Printer className="h-3.5 w-3.5" /> Print
            </Button>

            <Button
              variant="default"
              size="sm"
              className="gap-1.5"
              disabled={loading || downloading}
              onClick={async () => {
                if (downloading) return;
                setDownloading(true);
                try {
                  let blobToDownload = pdfBlob;
                  if (!blobToDownload && currentQuotation && comp) {
                    blobToDownload = await exportQuotationPDF(currentQuotation, comp as any, cust as any, template);
                    setPdfBlob(blobToDownload);
                  }
                  if (blobToDownload && currentQuotation) {
                    triggerDownload(blobToDownload, `${currentQuotation.number}.pdf`);
                    toast.success(`Downloaded ${currentQuotation.number}.pdf`);
                  }
                } catch (err: any) {
                  console.error("Failed to download PDF:", err);
                  toast.error("Failed to download PDF.");
                } finally {
                  setDownloading(false);
                }
              }}
            >
              {downloading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating PDF…
                </>
              ) : (
                <>
                  <Download className="h-3.5 w-3.5" /> Download PDF
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
