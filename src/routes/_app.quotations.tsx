import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { QuotationsPage } from "@/components/app/QuotationsPage";

export const Route = createFileRoute("/_app/quotations")({
  head: () => ({ meta: [{ title: "Quotations — Business Management" }] }),
  component: () => (
    <AppShell title="Quotations">
      <QuotationsPage />
    </AppShell>
  ),
});
