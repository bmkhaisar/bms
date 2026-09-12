import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Wallet, AlertTriangle, ShieldAlert, CheckCircle2, PlusCircle, ArrowRight } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { type Party, type PartyAddress } from "@/lib/db";
import { getPartyFinancialInsight, type PartyFinancialInsight } from "@/modules/accounting/services/partyAdvanceService";
import { toPaise } from "@/modules/tax/taxEngine";

interface InvoicePartyStatusPanelProps {
  party: Party | null;
  invoiceTotal: number;
  onRecordReceipt?: (party: Party, requiredAmount: number) => void;
  onSelectAddress?: (address: PartyAddress) => void;
}

export function InvoicePartyStatusPanel({
  party,
  invoiceTotal,
  onRecordReceipt,
}: InvoicePartyStatusPanelProps) {
  const [insight, setInsight] = useState<PartyFinancialInsight | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!party?.id) {
      setInsight(null);
      return;
    }
    let active = true;
    setLoading(true);
    getPartyFinancialInsight(party.id)
      .then((res) => {
        if (active) setInsight(res);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [party?.id, invoiceTotal]);

  if (!party || !insight) return null;

  const invoiceTotalPaise = toPaise(invoiceTotal);
  const isAdvanceParty = party.paymentPolicy === "ADVANCE";
  const hasSufficientAdvance = insight.hasSufficientAdvance(invoiceTotalPaise);
  const deficitPaise = Math.max(0, invoiceTotalPaise - insight.availableAdvancePaise);
  const deficitRupees = deficitPaise / 100;

  const isCreditExceeded = insight.isCreditLimitExceeded(invoiceTotalPaise);
  const creditExcessRupees = insight.creditExcessPaise(invoiceTotalPaise) / 100;

  return (
    <div className="space-y-2 my-2">
      {/* Compact Status Card */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg border bg-muted/40 text-xs">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-foreground">{party.name}</div>
          {isAdvanceParty ? (
            <Badge variant="outline" className="border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 gap-1 text-[10px] font-bold">
              <Wallet className="h-3 w-3" /> ADVANCE POLICY
            </Badge>
          ) : (
            <Badge variant="outline" className="border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400 text-[10px] font-bold">
              CREDIT POLICY ({insight.creditDays}d)
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4 text-xs">
          {isAdvanceParty ? (
            <div>
              <span className="text-muted-foreground">Available Advance: </span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                {formatMoney(insight.availableAdvanceRupees)}
              </span>
            </div>
          ) : (
            <>
              <div>
                <span className="text-muted-foreground">Outstanding: </span>
                <span className="font-semibold text-foreground">
                  {formatMoney(insight.outstandingReceivableRupees)}
                </span>
              </div>
              {insight.creditLimitPaise > 0 && (
                <div>
                  <span className="text-muted-foreground">Credit Limit: </span>
                  <span className="font-semibold text-foreground">
                    {formatMoney(insight.creditLimitPaise / 100)}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ADVANCE RESTRICTION WARNING / BLOCK (PRD § 16) */}
      {isAdvanceParty && invoiceTotal > 0 && !hasSufficientAdvance && (
        <Alert variant="destructive" className="border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-400 text-xs py-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          <div className="space-y-1">
            <AlertTitle className="text-xs font-bold">Advance Payment Required</AlertTitle>
            <AlertDescription className="text-xs">
              This party is configured for Advance Payment.
              <div className="mt-1 font-medium">
                Available advance: <span className="font-bold">{formatMoney(insight.availableAdvanceRupees)}</span> &bull; Invoice total: <span className="font-bold">{formatMoney(invoiceTotal)}</span>
              </div>
              <div className="mt-1 text-[11px] text-red-600/90 dark:text-red-300">
                Shortfall: <strong>{formatMoney(deficitRupees)}</strong>. Record an additional Receipt Voucher before posting this invoice.
              </div>
            </AlertDescription>
            {onRecordReceipt && (
              <div className="pt-2">
                <Button
                  size="sm"
                  variant="default"
                  className="h-7 text-xs bg-red-600 hover:bg-red-700 text-white gap-1.5"
                  onClick={() => onRecordReceipt(party, deficitRupees)}
                >
                  <PlusCircle className="h-3.5 w-3.5" /> Record Receipt for {formatMoney(deficitRupees)}
                </Button>
              </div>
            )}
          </div>
        </Alert>
      )}

      {/* CREDIT LIMIT EXCEEDED WARNING (PRD § 20) */}
      {!isAdvanceParty && isCreditExceeded && (
        <Alert className="border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs py-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <div className="space-y-0.5">
            <AlertTitle className="text-xs font-semibold">Credit Limit Warning</AlertTitle>
            <AlertDescription className="text-xs">
              Credit limit of {formatMoney(insight.creditLimitPaise / 100)} will be exceeded by{" "}
              <strong>{formatMoney(creditExcessRupees)}</strong> (projected exposure:{" "}
              {formatMoney((insight.outstandingReceivablePaise + invoiceTotalPaise) / 100)}).
            </AlertDescription>
          </div>
        </Alert>
      )}

      {/* SUFFICIENT ADVANCE NOTICE (PRD § 17) */}
      {isAdvanceParty && invoiceTotal > 0 && hasSufficientAdvance && (
        <div className="flex items-center gap-1.5 p-2 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-medium border border-emerald-500/20">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
          <span>
            Sufficient advance available. <strong>{formatMoney(invoiceTotal)}</strong> will be automatically allocated against this invoice upon posting (Remaining advance: {formatMoney(insight.availableAdvanceRupees - invoiceTotal)}).
          </span>
        </div>
      )}
    </div>
  );
}
