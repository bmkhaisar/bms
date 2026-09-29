import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { Lock } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — BMS NEXT" },
      { name: "description", content: "How BMS NEXT handles information used to provide the service." },
      { property: "og:title", content: "Privacy Policy — BMS NEXT" },
      { property: "og:description", content: "Privacy policy and data protection principles of BMS NEXT." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicShell>
      {/* Ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[400px] w-full max-w-4xl bg-gradient-to-b from-purple-500/8 via-purple-300/4 to-transparent blur-3xl -z-10" />

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-20 space-y-8">
        {/* Page Header */}
        <div className="text-center max-w-xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3.5 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-4">
            <Lock className="h-3.5 w-3.5" />
            <span>Data Protection</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            How BMS NEXT handles information used to provide the service.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Effective Date: September 2026
          </p>
        </div>

        {/* Content Card */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-10 shadow-soft space-y-8 text-sm text-muted-foreground leading-relaxed">

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">1. Information We Process</h2>
            <p>BMS NEXT may process information required to operate the service, including:</p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Account information</li>
              <li>Organization information</li>
              <li>Branch and user configuration</li>
              <li>Customers and suppliers</li>
              <li>Products and inventory</li>
              <li>Quotations and invoices</li>
              <li>Receipts and payments</li>
              <li>Accounting and reporting information</li>
              <li>Files and business documents uploaded by authorized users</li>
            </ul>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">2. Why Information Is Used</h2>
            <p>Information is used to:</p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Provide BMS NEXT functionality</li>
              <li>Authenticate users</li>
              <li>Enforce organization and branch access</li>
              <li>Generate business documents</li>
              <li>Maintain financial and operational records</li>
              <li>Support synchronization and backup functionality</li>
              <li>Improve reliability and user experience</li>
            </ul>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">3. Access Control</h2>
            <p>
              BMS NEXT uses organization, branch, role and permission controls to restrict access to authorized users.
            </p>
            <p>
              Organization Owners control user access within their organization.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">4. Infrastructure</h2>
            <p>
              BMS NEXT currently uses cloud infrastructure including Firebase and Cloudflare R2 for supported application functionality and file storage.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">5. Customer Data</h2>
            <p>
              Business information entered by an organization remains associated with that organization.
            </p>
            <p>
              BMS NEXT does not intentionally expose one organization's operational data to another organization.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">6. Temporary and Trial Access</h2>
            <p>
              Organizations using beta or trial versions may use the same operational platform and should avoid entering information they are not authorized to store.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">7. Security</h2>
            <p>
              Reasonable technical safeguards are used to protect application access and business information.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">8. Data Requests</h2>
            <p>For questions regarding account or organization data, contact:</p>
            <a
              href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline underline-offset-2"
            >
              {PUBLIC_SUPPORT_EMAIL}
            </a>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">9. Policy Updates</h2>
            <p>
              This Privacy Policy may be updated as BMS NEXT evolves.
            </p>
            <p>
              The latest version will be made available on this page.
            </p>
          </section>

        </div>
      </div>
    </PublicShell>
  );
}
