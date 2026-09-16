import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Download, Printer, Pencil, FileCheck, ExternalLink, Loader2, Share2 } from "lucide-react";
import { db, type Quotation, type Customer, type CompanySettings, type QuotationTemplate } from "@/lib/db";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { useLive } from "@/lib/useLive";
import { downloadQuotationPDF, printQuotationPDF, exportQuotationPDF, triggerDownload } from "@/lib/quotationExport";
import { toast } from "sonner";

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
 * Production Preview Engine (PRD §§ 8-10, 60, Correction #1, #27):
 * Renders the actual generated vector PDF directly in an iframe/viewer so that:
 * 
 *                 Preview === Downloaded PDF
 * 
 * Displays all pages (Page 1, General Info, Tech Specs, Terms & Conditions, Bank Details, Signatory)
 * with 100% layout fidelity. Eliminates calculation or presentation drift between preview and export.
 * Directly reuses the generated PDF Blob for Download and Print.
 */
export function QuotationQuickPreviewModal({
  open,
  onOpenChange,
  quotation,
  onEdit,
  onConvert,
  onShare,
}: QuotationQuickPreviewModalProps) {
  const { activeCompany } = useActiveCompany();
  const customers = useLive<Customer>(() => db().customers.toArray());
  const companySettingsList = useLive<CompanySettings>(() => db().companySettings.toArray());
  const templates = useLive<QuotationTemplate>(() => db().quotationTemplates.toArray());
  const companySettings = companySettingsList[0];

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfBlob, setPdfBlob] = useState<Blob | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);

  // Canonical resolution: Draft uses current Company Settings defaults, Issued uses frozen snapshots
  const isDraft = !quotation?.status || quotation?.status === "draft";
  const comp = isDraft
    ? (activeCompany || quotation?.companySnapshot || companySettings)
    : (quotation?.companySnapshot || activeCompany || companySettings);
  const cust = quotation?.customerSnapshot || (customers ? customers.find((c) => c.id === quotation?.customerId) : undefined);
  const template = quotation?.templateId ? templates.find((t) => t.id === quotation.templateId) : undefined;

  useEffect(() => {
    if (!open || !quotation) {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
      setPdfUrl(null);
      setPdfBlob(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const timer = setTimeout(async () => {
      try {
        const blob = await exportQuotationPDF(quotation, comp as any, cust as any, template);
        if (!isMounted) return;

        if (prevBlobUrlRef.current) {
          URL.revokeObjectURL(prevBlobUrlRef.current);
        }

        const url = URL.createObjectURL(blob);
        prevBlobUrlRef.current = url;
        setPdfBlob(blob);
        setPdfUrl(url);
      } catch (err: any) {
        console.error("Failed to render PDF preview:", err);
        if (isMounted) {
          setError(err?.message || "Failed to generate preview PDF.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }, 150); // Debounce to keep UI responsive

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [open, quotation, comp, cust, template]);

  // Clean up object URL on component unmount
  useEffect(() => {
    return () => {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
    };
  }, []);

  if (!quotation) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl h-[94vh] max-h-[94vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header with Title & Quick Controls */}
        <DialogHeader className="p-3.5 border-b bg-muted/20 flex flex-row items-center justify-between">
          <DialogTitle className="flex items-center gap-2 text-base font-bold">
            <Eye className="h-4 w-4 text-primary" />
            Quotation Preview — {quotation.number}
            <Badge variant="outline" className="ml-2 uppercase text-[10px]">
              {quotation.status}
            </Badge>
            {quotation.gstCalculationMode === "overall" && (
              <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary border-primary/20">
                Overall GST {quotation.overallGstRate ?? 18}%
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

        {/* Multi-Page Vector PDF Viewport (Preview === Downloaded PDF) */}
        <div className="flex-1 w-full h-full min-h-0 bg-slate-100 flex items-center justify-center relative overflow-hidden">
          {loading && (
            <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-3">
              <Loader2 className="h-8 w-8 text-primary animate-spin" />
              <div className="text-sm font-semibold text-slate-800">Preparing Preview…</div>
              <div className="text-xs text-slate-500">
                Generating vector PDF pages with complete address, terms, specifications & bank details
              </div>
            </div>
          )}

          {error && !loading && (
            <div className="text-center p-8 max-w-md">
              <div className="text-destructive font-bold mb-2">Preview Generation Failed</div>
              <div className="text-xs text-muted-foreground mb-4">{error}</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (comp) downloadQuotationPDF(quotation, comp as any, cust as any, template);
                }}
              >
                <Download className="h-3.5 w-3.5 mr-1" /> Download PDF Instead
              </Button>
            </div>
          )}

          {pdfUrl && !loading && (
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0&scrollbar=1`}
              className="w-full h-full border-0 bg-white shadow-inner"
              title={`Quotation Preview - ${quotation.number}`}
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
                  onEdit(quotation);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit Quotation
              </Button>
            )}

            {onConvert && quotation.status !== "converted" && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5 text-primary border border-primary/20"
                onClick={() => {
                  onOpenChange(false);
                  onConvert(quotation);
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
                  onShare(quotation);
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
                } else if (comp && quotation) {
                  printQuotationPDF(quotation, comp as any, cust as any, template);
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
                  if (!blobToDownload && quotation && comp) {
                    blobToDownload = await exportQuotationPDF(quotation, comp as any, cust as any, template);
                    setPdfBlob(blobToDownload);
                  }
                  if (blobToDownload && quotation) {
                    triggerDownload(blobToDownload, `${quotation.number}.pdf`);
                    toast.success(`Downloaded ${quotation.number}.pdf`);
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
