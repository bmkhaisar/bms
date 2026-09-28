import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service — BMS NEXT" },
      { name: "description", content: "Terms of Service for BMS NEXT business management platform." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-3">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Legal Agreement</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Terms of Service
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Last updated: September 2026
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-soft space-y-6 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">1. Acceptance of Terms</h2>
            <p>
              By accessing or using BMS NEXT, you agree to be bound by these Terms of Service. If you are entering into this agreement on behalf of a company or other legal entity, you represent that you have the authority to bind such entity.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">2. Authorized Use & Workspace Access</h2>
            <p>
              Access to BMS NEXT workspaces is restricted to authorized company members with valid login credentials. Users must maintain credential confidentiality and immediately report unauthorized access to administrators.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">3. Business Data Sovereignty</h2>
            <p>
              All customer invoices, supplier records, inventory logs, and accounting journals created within your tenant remain your exclusive proprietary business data. BMS NEXT does not sell, market, or share your transactional data with third parties.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">4. System Availability & Offline Cache</h2>
            <p>
              BMS NEXT provides offline-first transactional caching in modern browsers. While best-effort cloud synchronization is maintained with high availability, users are responsible for periodic local backup exports.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">5. Termination & Export</h2>
            <p>
              You may terminate workspace usage at any time. Administrators have full capability to export complete historical records in standard JSON or CSV formats before account closure.
            </p>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
