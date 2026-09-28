import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { BmsBrandLockup } from "@/components/brand/BmsBrandLockup";
import { ShieldCheck, Cloud, Database, Layers, Sparkles, Building2, Terminal, Briefcase } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

export const Route = createFileRoute("/about")({
  head: () => ({
    meta: [
      { title: "About — BMS NEXT" },
      { name: "description", content: "Learn about BMS NEXT, our mission, and the founders building connected cloud trade software for Indian enterprises." },
      { property: "og:title", content: "About — BMS NEXT" },
      { property: "og:description", content: "Connected cloud business management built with precision." },
    ],
  }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-5xl px-4 sm:px-6 py-12 sm:py-16 space-y-16">
        {/* Header Hero */}
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <div className="flex justify-center mb-2">
            <BmsBrandLockup size="lg" />
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Crafted for modern trading operations.
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
            BMS NEXT is an integrated cloud business system engineered to replace disconnected spreadsheets, fragile billing software, and complicated accounting tools with a single fast, synchronized workspace.
          </p>
        </div>

        {/* Founders Section */}
        <section className="space-y-8">
          <div className="text-center max-w-xl mx-auto">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
              Leadership & Engineering
            </span>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
              Meet the Founders
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-3xl mx-auto">
            {/* Mohammed Maaz A */}
            <div className="rounded-3xl border border-purple-500/20 bg-card p-6 shadow-soft flex flex-col items-center text-center">
              <div className="relative mb-4">
                <img
                  src="/images/team/maaz.png"
                  alt="Mohammed Maaz A"
                  className="h-28 w-28 rounded-full object-cover border-2 border-purple-500/30 shadow-md"
                  onError={(e) => {
                    // Fallback to initials if image path fails to load
                    e.currentTarget.style.display = "none";
                  }}
                />
                <div className="absolute bottom-0 right-0 rounded-full bg-purple-600 text-white p-1 shadow-xs">
                  <Terminal className="h-3.5 w-3.5" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-foreground">Mohammed Maaz A</h3>
              <p className="text-xs font-semibold text-purple-600 dark:text-purple-400 mt-0.5">
                Co-Founder & Developer
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-3 max-w-xs">
                Architect of the BMS NEXT realtime engine, offline-first sync layer, Indian GST calculation pipelines, and high-performance UI.
              </p>
            </div>

            {/* Khaisar Hussain */}
            <div className="rounded-3xl border border-border/80 bg-card p-6 shadow-soft flex flex-col items-center text-center">
              <div className="relative mb-4">
                <div className="h-28 w-28 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border-2 border-indigo-500/30 flex items-center justify-center text-2xl font-black text-indigo-700 dark:text-indigo-300 shadow-md">
                  KH
                </div>
                <div className="absolute bottom-0 right-0 rounded-full bg-indigo-600 text-white p-1 shadow-xs">
                  <Briefcase className="h-3.5 w-3.5" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-foreground">Khaisar Hussain</h3>
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mt-0.5">
                Co-Founder — Sales & Operations
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed mt-3 max-w-xs">
                Directing business development, client relationship strategy, vendor onboarding, and daily field operation requirements across trading sectors.
              </p>
            </div>
          </div>
        </section>

        {/* Mission & Architectural Values */}
        <section className="rounded-3xl border border-border/80 bg-card p-8 sm:p-10 shadow-soft">
          <div className="max-w-3xl mx-auto space-y-6">
            <h2 className="text-xl font-bold text-foreground">
              Why We Built BMS NEXT
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Wholesale and retail businesses in India frequently encounter software that is either overly complex and expensive or hopelessly outdated desktop software that cannot sync across multiple locations without network errors.
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We engineered BMS NEXT from scratch with a unified modern stack: instant reactive synchronization, strict double-entry balancing, scoped branch permissions, and automated tax reporting. It gives business owners authoritative clarity over their entire enterprise.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border/50">
              <div className="flex items-start gap-2.5">
                <Cloud className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-foreground">Realtime Cloud</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Instant multi-device state updates with zero latency.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Database className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-foreground">Offline Resilience</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">IndexedDB cache ensures counters continue trading offline.</p>
                </div>
              </div>

              <div className="flex items-start gap-2.5">
                <Layers className="h-5 w-5 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-foreground">Zero Balance Drift</h4>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Authoritative ledger and day book mathematics.</p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
