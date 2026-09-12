import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, HelpCircle, Shield, MessageSquare, Building2 } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL, BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact & Support — BMS NEXT" },
      { name: "description", content: "Contact MMA for BMS NEXT support, account management, and product feedback." },
      { property: "og:title", content: "Contact & Support — BMS NEXT" },
      { property: "og:description", content: "Product support and inquiries for BMS NEXT." },
    ],
  }),
  component: ContactPage,
});

export function ContactPage() {
  return (
    <PublicShell>
      <div className="mx-auto max-w-3xl">
        <Card className="rounded-2xl border border-border/60 bg-card/75 backdrop-blur shadow-sm">
          <CardContent className="p-8">
            <div className="flex items-center gap-4">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
                <HelpCircle className="h-6 w-6" />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-foreground">Product Support & Access</h1>
                <p className="text-xs text-muted-foreground font-medium">{BRAND_TAGLINE}</p>
              </div>
            </div>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              For assistance with workspace setup, organization access, accounting reconciliation, or feature requests, contact our central support desk.
            </p>

            <div className="mt-6 space-y-3">
              <Row
                icon={Mail}
                label="Support Email"
                value={
                  <a
                    className="text-primary font-semibold hover:underline"
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
                label="Account & Access"
                value="Company onboarding, owner transfers, and platform administrator escalations"
              />
              <Row
                icon={MessageSquare}
                label="Feedback & Requests"
                value="Product suggestions and Indian GST workflow enhancements"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    </PublicShell>
  );
}

function Row({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 rounded-xl border border-border/50 bg-background/50 p-4">
      <div className="flex items-center gap-3 sm:w-48 shrink-0">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}
