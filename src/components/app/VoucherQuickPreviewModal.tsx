import { useEffect, useState, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Eye, Download, Printer, Share2, Loader2 } from "lucide-react";
import { downloadDocumentPDF, buildDocumentPDF, type NormalizedDocument } from "@/lib/documentRenderer";
import { formatMoney } from "@/lib/format";

interface VoucherQuickPreviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: NormalizedDocument | null;
  onShare?: () => void;
}

/**
 * VoucherQuickPreviewModal
 * 
 * Production Vector PDF Preview Engine for Receipt and Payment Vouchers.
 * Renders the exact vector PDF in an iframe viewer so that Preview === Downloaded Document.
 */
export function VoucherQuickPreviewModal({
  open,
  onOpenChange,
  document,
  onShare,
}: VoucherQuickPreviewModalProps) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const prevBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open || !document) {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
      setPdfUrl(null);
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      try {
        const pdfDoc = buildDocumentPDF(document);
        const blob = pdfDoc.output("blob");
        if (!isMounted) return;

        if (prevBlobUrlRef.current) {
          URL.revokeObjectURL(prevBlobUrlRef.current);
        }

        const url = URL.createObjectURL(blob);
        prevBlobUrlRef.current = url;
        setPdfUrl(url);
      } catch (err: any) {
        console.error("Failed to render voucher PDF preview:", err);
        if (isMounted) {
          setError(err?.message || "Failed to generate preview PDF.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }, 60);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [open, document]);

  useEffect(() => {
    return () => {
      if (prevBlobUrlRef.current) {
        URL.revokeObjectURL(prevBlobUrlRef.current);
        prevBlobUrlRef.current = null;
      }
    };
  }, []);

  if (!document) return null;

  const isPayment = document.kind === "payment";
  const titleText = isPayment
    ? `Payment Voucher — ${document.number}`
    : `Receipt Voucher — ${document.number}`;

  const handleDownload = () => {
    const filename = isPayment
      ? `Payment-Voucher-${document.number}.pdf`
      : `Receipt-Voucher-${document.number}.pdf`;
    downloadDocumentPDF(document, filename);
  };

  const handlePrint = () => {
    const iframe = window.document.getElementById("voucher-preview-iframe") as HTMLIFrameElement;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    } else {
      handleDownload();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[92vh] max-h-[92vh] overflow-hidden flex flex-col p-0 gap-0 rounded-2xl">
        <DialogHeader className="p-3.5 sm:p-4 border-b bg-muted/20 flex flex-row items-center justify-between shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm sm:text-base font-bold">
            <Eye className="h-4 w-4 text-primary" />
            <span>{titleText}</span>
            <Badge variant="outline" className={`ml-2 uppercase text-[10px] ${isPayment ? "border-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10" : "border-emerald-500/30 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10"}`}>
              {isPayment ? "F5 PAYMENT" : "F6 RECEIPT"}
            </Badge>
            <Badge variant="secondary" className="font-mono text-[11px] font-bold">
              {formatMoney(document.grandTotal)}
            </Badge>
          </DialogTitle>

          <div className="flex items-center gap-2 pr-6">
            {onShare && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs text-primary"
                onClick={onShare}
              >
                <Share2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Share</span>
              </Button>
            )}

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={handlePrint}
            >
              <Printer className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Print</span>
            </Button>

            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs bg-primary text-primary-foreground"
              onClick={handleDownload}
            >
              <Download className="h-3.5 w-3.5" />
              <span>Download PDF</span>
            </Button>
          </div>
        </DialogHeader>

        <div className="flex-1 bg-muted/40 relative overflow-hidden flex items-center justify-center">
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/60 backdrop-blur-xs z-10 gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground font-medium">Rendering vector voucher...</p>
            </div>
          )}

          {error && (
            <div className="p-6 text-center text-sm text-destructive max-w-md">
              <p className="font-semibold">Unable to preview document</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
          )}

          {pdfUrl && !error && (
            <iframe
              id="voucher-preview-iframe"
              src={pdfUrl}
              className="w-full h-full border-0"
              title={titleText}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
