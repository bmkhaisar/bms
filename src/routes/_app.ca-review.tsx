import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, type Invoice, type Purchase, type Receipt, type Product, type Party } from "@/lib/db";
import { useLiveState } from "@/lib/useLive";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { CAReviewWorkspace } from "@/modules/accounting/components/CAReviewWorkspace";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";

export const Route = createFileRoute("/_app/ca-review")({
  head: () => ({ meta: [{ title: "CA Review & Financial Insights — BMS NEXT" }] }),
  component: CAReviewPage,
});

function CAReviewPage() {
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const { ledgers, accountGroups, vouchers, loading: accountingLoading } = useAccounting();

  const invoicesState = useLiveState<Invoice>(() => db().invoices.toArray());
  const purchasesState = useLiveState<Purchase>(() => db().purchases.toArray());
  const receiptsState = useLiveState<Receipt>(() => db().receipts.toArray());
  const productsState = useLiveState<Product>(() => db().products.toArray());
  const partiesState = useLiveState<Party>(() => db().parties.toArray());

  const isDexieLoaded = invoicesState.isLoaded && purchasesState.isLoaded && receiptsState.isLoaded && productsState.isLoaded && partiesState.isLoaded;
  const isLoading = accountingLoading || !isDexieLoaded;

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
          vouchers={vouchers}
          invoices={invoicesState.data}
          receipts={receiptsState.data}
          purchases={purchasesState.data}
          products={productsState.data}
          parties={partiesState.data}
          loading={isLoading}
        />
      </div>
    </AppShell>
  );
}
