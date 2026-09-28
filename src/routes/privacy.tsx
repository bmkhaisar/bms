import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { Lock } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — BMS NEXT" },
      { name: "description", content: "Privacy policy and data protection principles of BMS NEXT cloud ERP." },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400 mb-3">
            <Lock className="h-3.5 w-3.5" />
            <span>Data Protection</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
            Privacy Policy
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Last updated: September 2026
          </p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-soft space-y-6 text-xs sm:text-sm text-muted-foreground leading-relaxed">
          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">1. Information We Collect</h2>
            <p>
              We collect information necessary to authenticate users and operate company workspaces, including user email addresses, company names, branch assignments, and system interaction logs for audit compliance.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">2. Tenant Isolation & Storage</h2>
            <p>
              Every company tenant is segmented with strict Firebase database rules and scoped client storage. Your records are never co-mingled or accessible to users from other organizations.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">3. Browser Cache & IndexedDB</h2>
            <p>
              To enable offline productivity and instantaneous search, BMS NEXT caches relevant company records locally inside your browser's IndexedDB. This data remains on your device and is cleared upon user sign-out.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">4. Third-Party Service Providers</h2>
            <p>
              We utilize trusted enterprise infrastructure providers: Google Firebase for real-time data persistence and authentication, and Cloudflare R2 for encrypted document storage.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="text-base font-bold text-foreground">5. Data Retention & Deletion</h2>
            <p>
              Company administrators retain full rights to request complete deletion of company databases and associated document assets upon contract expiration or service cancellation.
            </p>
          </section>
        </div>
      </div>
    </PublicShell>
  );
}
