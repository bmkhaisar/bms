import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  busyText,
  cancelText = "Cancel",
  destructive = false,
  isBusy: externalBusy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  confirmText?: string;
  busyText?: string;
  cancelText?: string;
  destructive?: boolean;
  isBusy?: boolean;
  onConfirm: () => void | Promise<void>;
}) {
  const [internalBusy, setInternalBusy] = useState(false);
  const isBusy = externalBusy ?? internalBusy;

  const defaultBusyText = busyText || (destructive ? "Deleting…" : "Processing…");

  async function handleConfirm(e: React.MouseEvent) {
    e.preventDefault();
    if (isBusy) return; // Prevent double clicks
    setInternalBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      console.error("[ConfirmDialog] onConfirm failed:", err);
    } finally {
      setInternalBusy(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (isBusy) return; // Disallow closing while action in flight
        onOpenChange(o);
      }}
    >
      <AlertDialogContent
        onKeyDown={(e) => {
          if (e.key === "Escape" && isBusy) {
            e.preventDefault();
          }
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base font-semibold">{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0 mt-3">
          <AlertDialogCancel disabled={isBusy} className="text-xs h-9">
            {cancelText}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={isBusy}
            className={`text-xs h-9 ${
              destructive
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm"
                : ""
            }`}
          >
            {isBusy ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                {defaultBusyText}
              </>
            ) : (
              confirmText
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
