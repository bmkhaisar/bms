import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { ShieldCheck } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Use — BMS NEXT" },
      { name: "description", content: "Terms governing access to and use of BMS NEXT business management platform." },
      { property: "og:title", content: "Terms of Use — BMS NEXT" },
      { property: "og:description", content: "Terms governing access to and use of BMS NEXT." },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <PublicShell>
      {/* Ambient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[400px] w-full max-w-4xl bg-gradient-to-b from-purple-500/8 via-purple-300/4 to-transparent blur-3xl -z-10" />

      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-20 space-y-8">
        {/* Page Header */}
        <div className="text-center max-w-xl mx-auto">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3.5 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-4">
            <ShieldCheck className="h-3.5 w-3.5" />
            <span>Legal Agreement</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Terms of Use
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Terms governing access to and use of BMS NEXT.
          </p>
          <p className="mt-1 text-xs text-muted-foreground/70">
            Effective Date: September 2026
          </p>
        </div>

        {/* Content Card */}
        <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-10 shadow-soft space-y-8 text-sm text-muted-foreground leading-relaxed">

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">1. About BMS NEXT</h2>
            <p>
              BMS NEXT is a Business Management System designed to help organizations manage operational workflows including quotations, invoices, collections, purchases, inventory, branches, accounting and business reporting.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">2. Access to the Service</h2>
            <p>
              Access to BMS NEXT may be provided through a trial, subscription, beta access or another agreed arrangement.
            </p>
            <p>
              Users are responsible for maintaining the confidentiality of their login credentials and for activities performed through their authorized account.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">3. Organization Administrators</h2>
            <p>
              Organization Owners and authorized administrators are responsible for managing their users, branches, permissions and business configuration within BMS NEXT.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">4. Business Information</h2>
            <p>
              Users are responsible for reviewing and verifying business information, financial records, tax information, documents and reports created or stored through BMS NEXT.
            </p>
            <p>
              BMS NEXT is a business software platform and does not replace professional legal, accounting or tax advice.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">5. Acceptable Use</h2>
            <p>Users must not attempt to:</p>
            <ul className="list-disc list-inside space-y-1 pl-1 text-muted-foreground">
              <li>Access another organization without authorization</li>
              <li>Bypass access controls</li>
              <li>Interfere with the operation of the service</li>
              <li>Use the platform for unlawful activity</li>
              <li>Intentionally upload malicious content</li>
            </ul>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">6. Availability and Changes</h2>
            <p>
              BMS NEXT may receive updates, improvements and feature changes over time, particularly during beta and trial periods.
            </p>
            <p>
              Temporary service interruptions may occur during maintenance or technical issues.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">7. Trials and Commercial Plans</h2>
            <p>
              A 30-day trial may be offered to eligible organizations.
            </p>
            <p>
              Future monthly, yearly or customized plans may be made available based on business requirements.
            </p>
            <p>
              Commercial terms will be communicated separately where applicable.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">8. Customer-Managed or Dedicated Setup</h2>
            <p>
              Organizations requiring dedicated infrastructure or a customized deployment may contact the BMS NEXT team to discuss available options.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">9. Intellectual Property</h2>
            <p>
              BMS NEXT software, interface, branding and platform components remain the property of their respective owners.
            </p>
            <p>
              Customers retain ownership of the business information they enter into the platform.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">10. Limitation</h2>
            <p>
              Users should maintain appropriate business records and independently review important accounting, statutory and operational information before relying on it for filing or legal purposes.
            </p>
          </section>

          <section className="space-y-2.5">
            <h2 className="text-base font-bold text-foreground">11. Contact</h2>
            <p>For questions regarding these Terms:</p>
            <a
              href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-purple-600 dark:text-purple-400 hover:underline underline-offset-2"
            >
              {PUBLIC_SUPPORT_EMAIL}
            </a>
          </section>

        </div>
      </div>
    </PublicShell>
  );
}
