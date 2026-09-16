import { useMemo } from "react";
import { formatMoney, formatDate } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, CheckCircle2, Clock, AlertTriangle, AlertCircle, HandCoins, Bell } from "lucide-react";
import type { Invoice, Party, CompanySettings, Receipt } from "@/lib/db";
import { computeInvoicePaymentInsight } from "@/modules/documents/sharing/paymentInsightService";

interface InvoicePaymentStatusPanelProps {
  invoice: Invoice;
  party?: Partial<Party> | null;
  company?: { defaultCreditDays?: number; creditDays?: number; [key: string]: any } | null;
  receipts?: Receipt[];
  onSendReminder?: () => void;
  className?: string;
  compact?: boolean;
}

export function InvoicePaymentStatusPanel({
  invoice,
  party,
  company,
  receipts = [],
  onSendReminder,
  className = "",
  compact = false,
}: InvoicePaymentStatusPanelProps) {
  const insight = useMemo(() => {
    return computeInvoicePaymentInsight({
      invoice,
      party,
      company,
      receipts,
    });
  }, [invoice, party, company, receipts]);

  const {
    invoiceTotal,
    totalReceived,
    balance,
    latestReceiptNumber,
    latestReceiptDate,
    dueDate,
    creditDays,
    isPaid,
    isOverdue,
    daysRemaining,
    daysOverdue,
    paidOnDate,
    statusVariant,
  } = insight;

  // Variant styles
  const variantStyles = {
    paid: {
      border: "border-mint/30 bg-mint/5 dark:bg-mint/10",
      badge: "border-mint/40 bg-mint/15 text-mint",
      text: "text-mint",
      icon: CheckCircle2,
    },
    neutral: {
      border: "border-blue-500/25 bg-blue-50/40 dark:bg-blue-950/20",
      badge: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-400",
      text: "text-blue-700 dark:text-blue-400",
      icon: Clock,
    },
    due_soon: {
      border: "border-amber-500/30 bg-amber-50/40 dark:bg-amber-950/20",
      badge: "border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400",
      text: "text-amber-700 dark:text-amber-400",
      icon: AlertTriangle,
    },
    overdue: {
      border: "border-destructive/30 bg-destructive/5 dark:bg-destructive/10",
      badge: "border-destructive/40 bg-destructive/15 text-destructive",
      text: "text-destructive",
      icon: AlertCircle,
    },
  }[statusVariant];

  const Icon = variantStyles.icon;

  if (compact) {
    return (
      <div className={`flex flex-wrap items-center gap-2 text-xs ${className}`}>
        <Badge variant="outline" className={`gap-1 font-semibold text-[10px] ${variantStyles.badge}`}>
          <Icon className="h-3 w-3" />
          {isPaid
            ? `PAID ${paidOnDate ? `(${formatDate(paidOnDate)})` : ""}`
            : isOverdue
            ? `${daysOverdue}d overdue`
            : `${daysRemaining}d remaining`}
        </Badge>

        {!isPaid && (
          <span className="font-mono text-muted-foreground text-[11px]">
            Bal: <strong className="text-foreground">{formatMoney(balance)}</strong>
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`rounded-xl border p-3.5 space-y-2.5 transition-all text-xs ${variantStyles.border} ${className}`}>
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={`gap-1 font-semibold text-[10px] uppercase ${variantStyles.badge}`}>
            <Icon className="h-3.5 w-3.5" />
            {isPaid
              ? "PAID"
              : isOverdue
              ? `${daysOverdue} DAYS OVERDUE`
              : `${daysRemaining} DAYS REMAINING`}
          </Badge>

          {isPaid && paidOnDate ? (
            <span className="text-[11px] text-muted-foreground font-medium">
              Paid On {formatDate(paidOnDate)}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Credit terms: {creditDays} days
            </span>
          )}
        </div>

        {/* Send Reminder Action Button (PRD § 24) */}
        {!isPaid && balance > 0 && onSendReminder && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSendReminder}
            className="h-7 text-xs gap-1.5 font-semibold border-border hover:bg-background"
          >
            <Bell className="h-3.5 w-3.5 text-primary" />
            Send Reminder
          </Button>
        )}
      </div>

      {/* Grid of Key Data Points (PRD § 22) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 border-t border-border/40">
        <div>
          <div className="text-[10px] text-muted-foreground">Invoice Total</div>
          <div className="font-mono font-semibold text-foreground text-xs">{formatMoney(invoiceTotal)}</div>
        </div>

        <div>
          <div className="text-[10px] text-muted-foreground">Received</div>
          <div className="font-mono font-semibold text-mint text-xs">{formatMoney(totalReceived)}</div>
        </div>

        <div>
          <div className="text-[10px] text-muted-foreground">Balance</div>
          <div className={`font-mono font-semibold text-xs ${balance > 0 ? "text-amber-700 dark:text-amber-400 font-bold" : "text-foreground"}`}>
            {formatMoney(balance)}
          </div>
        </div>

        <div>
          <div className="text-[10px] text-muted-foreground">Due Date</div>
          <div className="font-medium text-foreground text-xs">{formatDate(dueDate)}</div>
        </div>
      </div>

      {/* Latest Receipt details if applicable */}
      {latestReceiptNumber && (
        <div className="flex flex-wrap items-center justify-between text-[11px] text-muted-foreground pt-1 border-t border-border/40">
          <span>
            Latest Receipt: <strong className="text-foreground font-mono">{latestReceiptNumber}</strong>
          </span>
          {latestReceiptDate && (
            <span>Received On: {formatDate(latestReceiptDate)}</span>
          )}
        </div>
      )}
    </div>
  );
}
