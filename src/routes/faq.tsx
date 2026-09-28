import { createFileRoute } from "@tanstack/react-router";
import { PublicShell } from "@/components/app/PublicShell";
import { useState } from "react";
import { ChevronDown, HelpCircle, Mail } from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

export const Route = createFileRoute("/faq")({
  head: () => ({
    meta: [
      { title: "FAQ — BMS NEXT" },
      { name: "description", content: "Frequently asked questions regarding BMS NEXT cloud ERP, Indian GST, multi-branch operations, and trial access." },
    ],
  }),
  component: FaqPage,
});

function FaqPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <PublicShell>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 py-12 sm:py-16 space-y-12">
        <div className="text-center max-w-xl mx-auto space-y-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-purple-500/20 bg-purple-500/5 px-3 py-1 text-xs font-semibold text-purple-600 dark:text-purple-400">
            <HelpCircle className="h-3.5 w-3.5" />
            <span>Knowledge Base</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Frequently Asked Questions
          </h1>
          <p className="text-sm text-muted-foreground">
            Everything you need to know about BMS NEXT features, architecture, and onboarding.
          </p>
        </div>

        <div className="space-y-3">
          {faqList.map((item, index) => {
            const isOpen = openFaq === index;
            return (
              <div
                key={index}
                className="rounded-2xl border border-border/80 bg-card overflow-hidden transition-colors"
              >
                <button
                  type="button"
                  onClick={() => toggleFaq(index)}
                  className="w-full flex items-center justify-between p-5 text-left text-sm font-bold text-foreground hover:bg-muted/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="pr-4">{item.q}</span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${
                      isOpen ? "rotate-180 text-purple-600 dark:text-purple-400" : ""
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-5 pb-5 text-xs text-muted-foreground leading-relaxed border-t border-border/40 pt-3 animate-in fade-in duration-150">
                    {item.a}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-purple-500/20 bg-purple-500/5 p-6 text-center space-y-3">
          <h3 className="text-base font-bold text-foreground">Still have questions?</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Contact our engineering and onboarding desk directly. We respond within a few business hours.
          </p>
          <div>
            <a
              href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-2 rounded-full bg-[#6D5DFB] hover:bg-[#5A4BE0] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-transform hover:scale-102"
            >
              <Mail className="h-3.5 w-3.5" />
              <span>Email {PUBLIC_SUPPORT_EMAIL}</span>
            </a>
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

const faqList = [
  {
    q: "How does the 30-day free trial work?",
    a: "You receive full, unrestricted access to the complete BMS NEXT system for 30 days. No credit card is required. Our team provisions your workspace, sets up your initial company profile and branches, and provides onboarding support.",
  },
  {
    q: "Does BMS NEXT support Indian GST compliance?",
    a: "Yes. It supports CGST, SGST, IGST, and UTGST calculations, HSN/SAC code tracking, and clean tax summaries required for GSTR-1 and GSTR-3B filings.",
  },
  {
    q: "Can we manage multiple branches under one company?",
    a: "Absolutely. BMS NEXT allows creating unlimited branches (warehouses, shops, offices). Staff can be restricted to their branch while owners see unified data across all locations.",
  },
  {
    q: "Is our business data safe if our internet connection drops?",
    a: "Yes. BMS NEXT employs an offline-first architecture powered by Dexie IndexedDB. You can continue viewing records and creating drafts even during connection drops. Data synchronizes automatically when online.",
  },
  {
    q: "Can our Chartered Accountant (CA) access our books directly?",
    a: "Yes. You can grant CA Review role access to your accountant. They get dedicated read access to trial balances, day books, ledger statements, and Excel/JSON exports.",
  },
  {
    q: "Can we import existing customer, supplier, and inventory data?",
    a: "Yes. We provide easy-to-use CSV/Excel import templates for bulk importing customer masters, supplier ledgers, and existing inventory balances.",
  },
  {
    q: "Are user permissions customizable per staff member?",
    a: "Yes. Roles include Owner, Admin, Branch Manager, Billing Staff, and CA Review. Each role has strictly enforced read and write boundaries.",
  },
  {
    q: "Can we generate vector PDF invoices and print them directly?",
    a: "Yes. BMS NEXT generates crisp, vector-rendered PDFs with your company branding, bank details, terms, and authorized signatory blocks suitable for A4 thermal or laser printing.",
  },
  {
    q: "How is BMS NEXT hosted and deployed?",
    a: "BMS NEXT is hosted on high-availability cloud infrastructure with Google Firebase Realtime Database and Cloudflare R2 storage. Dedicated private deployments are also available on request.",
  },
];
