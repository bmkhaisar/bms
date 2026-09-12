import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, PlusCircle, FileText, X } from "lucide-react";
import { formatMoney } from "@/lib/format";

interface AdvanceRestrictionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  partyName: string;
  availableAdvance: number;
  invoiceTotal: number;
  onRecordReceipt: () => void;
  onSaveDraft: () => void;
}

export function AdvanceRestrictionModal({
  open,
  onOpenChange,
  partyName,
  availableAdvance,
  invoiceTotal,
  onRecordReceipt,
  onSaveDraft,
}: AdvanceRestrictionModalProps) {
  const deficit = Math.max(0, invoiceTotal - availableAdvance);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400 font-bold">
            <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
            Advance Payment Required
          </DialogTitle>
          <DialogDescription className="text-xs text-foreground/80 leading-relaxed pt-2">
            This party (<span className="font-semibold text-foreground">{partyName}</span>) is configured for{" "}
            <span className="font-bold text-amber-700 dark:text-amber-400">Advance Payment</span> policy.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/50 bg-amber-50/50 dark:bg-amber-950/20 p-4 space-y-2 text-xs">
          <div className="flex justify-between items-center text-muted-foreground">
            <span>Invoice Total:</span>
            <span className="font-mono font-bold text-foreground text-sm">{formatMoney(invoiceTotal)}</span>
          </div>
          <div className="flex justify-between items-center text-muted-foreground">
            <span>Available Unapplied Advance:</span>
            <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 text-sm">
              {formatMoney(availableAdvance)}
            </span>
          </div>
          <div className="pt-2 border-t border-amber-200/60 dark:border-amber-900/40 flex justify-between items-center">
            <span className="font-semibold text-destructive">Required Advance Deficit:</span>
            <span className="font-mono font-extrabold text-destructive text-sm">{formatMoney(deficit)}</span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-normal">
          Record an additional Receipt Voucher before issuing this invoice, or save this invoice as a draft to retain your work.
        </p>

        <DialogFooter className="flex-col sm:flex-row gap-2 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="gap-1 sm:order-1">
            <X className="h-4 w-4" /> Cancel
          </Button>
          <Button variant="secondary" size="sm" onClick={onSaveDraft} className="gap-1.5 sm:order-2">
            <FileText className="h-4 w-4" /> Save as Draft
          </Button>
          <Button size="sm" onClick={onRecordReceipt} className="gap-1.5 sm:order-3 bg-amber-600 hover:bg-amber-700 text-white">
            <PlusCircle className="h-4 w-4" /> Record Receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
