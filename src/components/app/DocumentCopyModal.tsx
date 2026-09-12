import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, Printer, Copy, FileText, CheckCircle2, ShieldCheck } from "lucide-react";
import { downloadDocumentPDF, type NormalizedDocument, type DocumentCopyType } from "@/lib/documentRenderer";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  docData: NormalizedDocument | null;
  onPrint?: (copyLabel: DocumentCopyType) => void;
}

export const COPY_OPTIONS: Array<{ value: DocumentCopyType; label: string; description: string; color: string }> = [
  { value: "ORIGINAL", label: "ORIGINAL", description: "Primary legal invoice for recipient / buyer", color: "text-blue-700 bg-blue-50 border-blue-200" },
  { value: "COPY", label: "COPY", description: "Standard business duplicate copy", color: "text-rose-700 bg-rose-50 border-rose-200" },
  { value: "CUSTOMER COPY", label: "CUSTOMER COPY", description: "Customer reference copy", color: "text-rose-700 bg-rose-50 border-rose-200" },
  { value: "OFFICE COPY", label: "OFFICE COPY", description: "Internal office / accounting filing copy", color: "text-rose-700 bg-rose-50 border-rose-200" },
  { value: "TRANSPORT COPY", label: "TRANSPORT COPY", description: "Logistics / transporter transit document", color: "text-rose-700 bg-rose-50 border-rose-200" },
  { value: "DRIVER COPY", label: "DRIVER COPY", description: "Delivery driver transit acknowledgment", color: "text-rose-700 bg-rose-50 border-rose-200" },
];

export function DocumentCopyModal({ open, onOpenChange, docData, onPrint }: Props) {
  const [copyLabel, setCopyLabel] = useState<DocumentCopyType>("ORIGINAL");
  const [downloading, setDownloading] = useState(false);

  if (!docData) return null;

  function handleDownload() {
    if (!docData) return;
    setDownloading(true);
    try {
      downloadDocumentPDF({
        ...docData,
        copyLabel,
      });
      toast.success(`Generated ${copyLabel} for ${docData.number}`);
      onOpenChange(false);
    } catch (err) {
      console.error("PDF generation failed:", err);
      toast.error("Failed to generate PDF");
    } finally {
      setDownloading(false);
    }
  }

  function handlePrint() {
    if (onPrint) {
      onPrint(copyLabel);
      onOpenChange(false);
    } else {
      handleDownload();
    }
  }

  const selectedOpt = COPY_OPTIONS.find((c) => c.value === copyLabel) || COPY_OPTIONS[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-4 sm:p-6">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle className="text-base font-bold">Document Export & Copies</DialogTitle>
          </div>
          <DialogDescription className="text-xs">
            Export {docData.title} <span className="font-mono font-semibold text-foreground">{docData.number}</span> with authorized copy designation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-xs py-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground">Select Document Copy Designation</label>
            <Select value={copyLabel} onValueChange={(v) => setCopyLabel(v as DocumentCopyType)}>
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COPY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{opt.label}</span>
                      <span className="text-[10px] text-muted-foreground">({opt.description})</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Visual Preview Badge */}
          <div className="rounded-xl border p-3 bg-muted/20 space-y-2">
            <div className="text-[11px] text-muted-foreground flex items-center justify-between">
              <span>PDF Badge Preview:</span>
              <span className="text-[10px]">Vector Selectable Text</span>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded text-xs font-bold border tracking-wider ${selectedOpt.color}`}>
                {selectedOpt.label}
              </span>
              <span className="text-[11px] text-muted-foreground">{selectedOpt.description}</span>
            </div>
          </div>

          <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-[11px] text-emerald-800 dark:text-emerald-300 flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              <b>Financial Invariance:</b> Generating copies does not duplicate vouchers, change GST registers, or alter stock movement ledgers.
            </span>
          </div>
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrint} className="gap-1.5">
            <Printer className="h-4 w-4" /> Print {copyLabel}
          </Button>
          <Button size="sm" onClick={handleDownload} disabled={downloading} className="gap-1.5">
            <Download className="h-4 w-4" /> Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
