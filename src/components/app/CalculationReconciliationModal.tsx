import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calculator, CheckCircle2, X } from "lucide-react";
import { formatMoney } from "@/lib/format";

interface CalculationReconciliationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientTotal: number;
  authoritativeTotal: number;
  onConfirmAndPost: () => void;
}

export function CalculationReconciliationModal({
  open,
  onOpenChange,
  clientTotal,
  authoritativeTotal,
  onConfirmAndPost,
}: CalculationReconciliationModalProps) {
  const diff = authoritativeTotal - clientTotal;
  const isIncrease = diff > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base text-primary font-bold">
            <Calculator className="h-5 w-5 text-primary flex-shrink-0" />
            Review Authoritative Totals
          </DialogTitle>
          <DialogDescription className="text-xs text-foreground/80 leading-relaxed pt-2">
            Invoice statutory tax and line totals were recalculated using the canonical tax engine.
            Please review the verified figures before posting.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-2.5 text-xs">
          <div className="flex justify-between items-center text-muted-foreground">
            <span>Previous Draft Total:</span>
            <span className="font-mono text-foreground">{formatMoney(clientTotal)}</span>
          </div>
          <div className="flex justify-between items-center font-medium">
            <span className="text-foreground">Authoritative Recomputed Total:</span>
            <span className="font-mono font-bold text-primary text-base">
              {formatMoney(authoritativeTotal)}
            </span>
          </div>
          <div className="pt-2 border-t border-primary/20 flex justify-between items-center">
            <span className="text-muted-foreground">Adjustment Difference:</span>
            <span
              className={`font-mono font-bold ${
                Math.abs(diff) < 0.01
                  ? "text-muted-foreground"
                  : isIncrease
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {diff > 0 ? `+${formatMoney(diff)}` : formatMoney(diff)}
            </span>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-normal">
          Clicking <strong>Confirm & Post</strong> will apply the verified figures and finalize the double-entry accounting entries.
        </p>

        <DialogFooter className="gap-2 sm:gap-0 pt-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} className="gap-1">
            <X className="h-4 w-4" /> Cancel & Edit
          </Button>
          <Button size="sm" onClick={onConfirmAndPost} className="gap-1.5 bg-primary text-primary-foreground">
            <CheckCircle2 className="h-4 w-4" /> Confirm & Post
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
