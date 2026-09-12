import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { DocumentListPage } from "@/components/app/DocumentListPage";
import type { Purchase } from "@/lib/db";

export const Route = createFileRoute("/_app/purchases")({
  head: () => ({ meta: [{ title: "Purchases — Business Management" }] }),
  component: () => (
    <AppShell title="Purchases">
      <DocumentListPage<Purchase> kind="purchase" title="Purchases" addLabel="New purchase" tableFor="supplier" />
    </AppShell>
  ),
});
