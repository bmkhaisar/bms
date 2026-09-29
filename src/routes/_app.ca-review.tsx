import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, type Invoice, type Purchase, type Receipt, type Payment, type Product, type Party } from "@/lib/db";
import { useLiveState } from "@/lib/useLive";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { CAReviewWorkspace } from "@/modules/accounting/components/CAReviewWorkspace";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";

import { useMemo } from "react";
import { useBusinessScope } from "@/modules/company/context/BusinessScopeContext";
import type { SalesReturn, CreditNote } from "@/lib/db";

export const Route = createFileRoute("/_app/ca-review")({
  head: () => ({ meta: [{ title: "CA Review & Financial Insights — BMS NEXT" }] }),
  component: CAReviewPage,
});

function CAReviewPage() {
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const { activeBranchId } = useBusinessScope();
  const { ledgers, accountGroups, vouchers, loading: accountingLoading } = useAccounting();

  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const receiptsState = useLiveState<Receipt>(() => db().receipts.toArray());
  const paymentsState = useLiveState<Payment>(() => db().payments.toArray());
  const productsState = useLiveState<Product>(() => db().products.toArray());
  const partiesState = useLiveState<Party>(() => db().parties.toArray());
  const salesReturnsState = useLiveState<SalesReturn>(() => db().salesReturns.toArray());
  const creditNotesState = useLiveState<CreditNote>(() => db().creditNotes.toArray());

  const isDexieLoaded =
    invoicesState.isLoaded &&
    purchasesState.isLoaded &&
    receiptsState.isLoaded &&
    paymentsState.isLoaded &&
    productsState.isLoaded &&
    partiesState.isLoaded &&
    salesReturnsState.isLoaded &&
    creditNotesState.isLoaded;
  const isLoading = accountingLoading || !isDexieLoaded;

  // Strict branch isolation for CA Review
  const scopedInvoices = useMemo(() => {
    return invoicesState.data.filter((i) => {
      if (activeBranchId && activeBranchId !== "all" && i.branchId && i.branchId !== activeBranchId) return false;
      return true;
    });
  }, [invoicesState.data, activeBranchId]);

  const scopedPurchases = useMemo(() => {
    return purchasesState.data.filter((p) => {
      if (activeBranchId && activeBranchId !== "all" && p.branchId && p.branchId !== activeBranchId) return false;
      return true;
    });
  }, [purchasesState.data, activeBranchId]);

  const scopedReceipts = useMemo(() => {
    return receiptsState.data.filter((r) => {
      if (activeBranchId && activeBranchId !== "all" && r.branchId && r.branchId !== activeBranchId) return false;
      return true;
    });
  }, [receiptsState.data, activeBranchId]);

  const scopedPayments = useMemo(() => {
    return paymentsState.data.filter((p) => {
      if (activeBranchId && activeBranchId !== "all" && p.branchId && p.branchId !== activeBranchId) return false;
      return true;
    });
  }, [paymentsState.data, activeBranchId]);

  const scopedVouchers = useMemo(() => {
    return vouchers.filter((v) => {
      if (activeBranchId && activeBranchId !== "all" && (v as any).branchId && (v as any).branchId !== activeBranchId) return false;
      return true;
    });
  }, [vouchers, activeBranchId]);

  const scopedSalesReturns = useMemo(() => {
    return salesReturnsState.data.filter((r) => {
      if (activeBranchId && activeBranchId !== "all" && r.branchId && r.branchId !== activeBranchId) return false;
      return true;
    });
  }, [salesReturnsState.data, activeBranchId]);

  const scopedCreditNotes = useMemo(() => {
    return creditNotesState.data.filter((c) => {
      if (activeBranchId && activeBranchId !== "all" && c.branchId && c.branchId !== activeBranchId) return false;
      return true;
    });
  }, [creditNotesState.data, activeBranchId]);

  return (
    <AppShell title="CA Review">
      <div className="animate-fade-in space-y-4">
        <PageHeader
          title="CA Review & Financial Insights"
          description="Accounting health, reconciliations, tax position and management review. Read-only audit workspace."
        />

        <CAReviewWorkspace
          ledgers={ledgers}
          accountGroups={accountGroups}
          vouchers={scopedVouchers}
          invoices={scopedInvoices}
          receipts={scopedReceipts}
          purchases={scopedPurchases}
          payments={scopedPayments}
          products={productsState.data}
          parties={partiesState.data}
          salesReturns={scopedSalesReturns}
          creditNotes={scopedCreditNotes}
          loading={isLoading}
        />
      </div>
    </AppShell>
  );
}
