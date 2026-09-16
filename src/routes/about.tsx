import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Cloud, Database, FileText, Layers, ShieldCheck } from "lucide-react";
import { BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — BMS NEXT" },
      { name: "description", content: "BMS NEXT — Connected cloud accounting and business management with offline-first local cache." },
      { property: "og:title", content: "About — BMS NEXT" },
      { property: "og:description", content: "Connected cloud business management crafted by MMA." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <PublicShell>
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft lg:col-span-2">
          <CardContent className="p-8">
            <div className="flex items-center gap-4">
              <div className="grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <Building2 className="h-7 w-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">BMS NEXT</h1>
                <p className="text-sm text-muted-foreground font-medium">
                  {BRAND_TAGLINE}
                </p>
              </div>
            </div>

            <p className="mt-6 text-sm leading-relaxed text-muted-foreground">
              BMS NEXT is a unified business operations and accounting suite built specifically for Indian businesses.
              It couples cloud synchronization with an active offline cache so your day-to-day operations remain responsive, reliable, and uninterrupted even during connectivity drops.
            </p>

            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <Feature
                icon={Cloud}
                title="Realtime Cloud Synchronization"
                desc="Realtime cloud state updates connected devices instantly while preserving tenant isolation."
              />
              <Feature
                icon={Database}
                title="Offline-First Active Cache"
                desc="Fast startup and resilient offline browsing powered by scoped IndexedDB storage."
              />
              <Feature
                icon={Layers}
                title="Authoritative Double-Entry"
                desc="Automated journal entries, day books, ledgers, and trial balances with zero balance drift."
              />
              <Feature
                icon={FileText}
                title="Indian GST Compliance"
                desc="Structured quotations, tax invoices, purchase vouchers, HSN/SAC classifications, and tax breakdown."
              />
              <Feature
                icon={ShieldCheck}
                title="Multi-Company Partitioning"
                desc="Strict per-company workspace isolation, role-based controls, and session lifetime guarantees."
              />
              <Feature
                icon={Building2}
                title="Enterprise Architecture"
                desc="Built by MMA with precision, vector PDF document generation, and continuous audit trails."
              />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border border-border/80 bg-card shadow-soft">
          <CardContent className="p-8">
            <h2 className="text-base font-semibold text-foreground">Current Capabilities</h2>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                <span className="font-medium text-foreground block">Documents</span>
                <span>Quotations, GST Invoices, Purchases, Receipts, and Payments.</span>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                <span className="font-medium text-foreground block">Ledger & Master Data</span>
                <span>Customer and supplier subledgers, inventory catalog, and custom groups.</span>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                <span className="font-medium text-foreground block">Financial Reports</span>
                <span>Realtime Day Book, Ledger Statements, and balanced Trial Balance.</span>
              </div>
              <div className="rounded-lg border border-border/50 bg-background/50 p-3">
                <span className="font-medium text-foreground block">Security & Access</span>
                <span>Role-based company memberships and strict 2-hour session limits.</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </PublicShell>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: typeof Building2; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-muted/20 p-4 transition-colors hover:bg-muted/40">
      <Icon className="h-5 w-5 text-primary" />
      <div className="mt-2 text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</div>
    </div>
  );
}
