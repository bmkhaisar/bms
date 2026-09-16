import { createFileRoute } from "@tanstack/react-router";
import { AppShell, PageHeader } from "@/components/app/AppShell";
import { db, type Invoice, type Purchase, type Receipt, type Product, type Party } from "@/lib/db";
import { useLive } from "@/lib/useLive";
import { useAccounting } from "@/modules/accounting/useAccounting";
import { CAReviewWorkspace } from "@/modules/accounting/components/CAReviewWorkspace";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_app/ca-review")({
  head: () => ({ meta: [{ title: "CA Review & Financial Insights — BMS NEXT" }] }),
  component: CAReviewPage,
});

function CAReviewPage() {
  const { activeCompany, activeFinancialYear } = useActiveCompany();
  const { ledgers, accountGroups, vouchers, loading: accountingLoading } = useAccounting();

  const invoices = useLive<Invoice>(() => db().invoices.toArray()) || [];
  const purchases = useLive<Purchase>(() => db().purchases.toArray()) || [];
  const receipts = useLive<Receipt>(() => db().receipts.toArray()) || [];
  const products = useLive<Product>(() => db().products.toArray()) || [];
  const parties = useLive<Party>(() => db().parties.toArray()) || [];

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
          invoices={invoices}
          receipts={receipts}
          purchases={purchases}
          products={products}
          parties={parties}
        />
      </div>
    </AppShell>
  );
}
