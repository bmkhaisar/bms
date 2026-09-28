import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, HelpCircle, Shield, MessageSquare, Building2, ArrowRight } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL, BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact & Support — BMS NEXT" },
      { name: "description", content: "Contact BMS NEXT for support, free trial onboarding, multi-branch setups, and direct founder inquiries." },
      { property: "og:title", content: "Contact & Support — BMS NEXT" },
      { property: "og:description", content: "Product support and inquiries for BMS NEXT." },
    ],
  }),
  component: ContactPage,
});

function ContactPage() {
  const trialMailto = `mailto:${PUBLIC_SUPPORT_EMAIL}?subject=BMS%20NEXT%20Inquiry&body=Hi%20Maaz,%0D%0A%0D%0AWe%20would%20like%20to%20learn%20more%20about%20BMS%20NEXT.%0D%0A%0D%0ACompany:%0D%0AContact:%0D%0APhone:`;

  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-12 sm:py-16 space-y-8">
        <div className="text-center max-w-xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Direct Inquiries</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Contact BMS NEXT
          </h1>
          <p className="text-sm text-muted-foreground">
            Whether you want to start a 30-day trial or require dedicated deployment assistance, we are here to help.
          </p>
        </div>

        <Card className="rounded-3xl border border-border/80 bg-card shadow-soft overflow-hidden">
          <CardContent className="p-6 sm:p-8 space-y-6">
            <div className="space-y-3">
              <Row
                icon={Mail}
                label="Direct Support Email"
                value={
                  <a
                    className="text-purple-600 dark:text-purple-400 font-bold hover:underline"
                    href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
                  >
                    {PUBLIC_SUPPORT_EMAIL}
                  </a>
                }
              />
              <Row
                icon={Building2}
                label="Organization"
                value={`${BRAND_ATTRIBUTION} Business Systems`}
              />
              <Row
                icon={Shield}
                label="Account & Onboarding"
                value="Company workspace provisioning, branch setup, and admin escalations"
              />
              <Row
                icon={MessageSquare}
                label="Product Feedback"
                value="Feature requests, Indian GST compliance additions, and hardware integration"
              />
            </div>

            <div className="pt-4 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs text-muted-foreground text-center sm:text-left">
                Typical response time: within 2 to 4 business hours.
              </div>
              <a
                href={trialMailto}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#6D5DFB] hover:bg-[#5A4BE0] px-6 py-2.5 text-xs font-bold text-white shadow-xs transition-transform hover:scale-102"
              >
                <span>Send Us an Email</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      </div>
    </PublicShell>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-2xl border border-border/50 bg-background/60 p-4">
      <div className="flex items-center gap-3 sm:w-48 shrink-0">
        <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-600 dark:text-purple-400">
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
