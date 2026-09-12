import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app/AppShell";
import { DocumentListPage } from "@/components/app/DocumentListPage";
import type { Invoice } from "@/lib/db";

export const Route = createFileRoute("/_app/invoices")({
  head: () => ({ meta: [{ title: "GST Invoices — Business Management" }] }),
  component: () => (
    <AppShell title="GST Invoices">
      <DocumentListPage<Invoice> kind="invoice" title="GST Invoices" addLabel="New invoice" tableFor="customer" />
    </AppShell>
  ),
});
