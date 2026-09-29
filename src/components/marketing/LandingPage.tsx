import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  Receipt,
  Boxes,
  Building2,
  TrendingUp,
  ShieldCheck,
  Layers,
  ChevronDown,
  Mail,
  Zap,
  Lock,
  BarChart3,
  Server,
  Users,
} from "lucide-react";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";
import { BmsBrandMark } from "@/components/brand/BmsBrandMark";

export function LandingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const trialMailto = `mailto:${PUBLIC_SUPPORT_EMAIL}?subject=BMS%20NEXT%2030-Day%20Free%20Trial%20Request&body=Hi%20Maaz,%0D%0A%0D%0AI%20would%20like%20to%20request%20a%2030-day%20free%20trial%20for%20BMS%20NEXT.%0D%0A%0D%0ACompany%20Name:%0D%0AContact%20Person:%0D%0APhone:%0D%0ANumber%20of%20Branches:`;

  const toggleFaq = (index: number) => {
    setOpenFaq(openFaq === index ? null : index);
  };

  return (
    <div className="relative overflow-hidden">
      {/* Background Soft Glows */}
      <div className="pointer-events-none absolute -top-40 left-1/2 -translate-x-1/2 h-[550px] w-full max-w-5xl bg-gradient-to-b from-purple-500/10 via-purple-300/5 to-transparent blur-3xl -z-10" />
      <div className="pointer-events-none absolute top-[900px] -left-48 h-96 w-96 rounded-full bg-purple-500/5 blur-3xl -z-10" />
      <div className="pointer-events-none absolute top-[1600px] -right-48 h-96 w-96 rounded-full bg-indigo-500/5 blur-3xl -z-10" />

      {/* ==================================================
          1. HERO SECTION
          ================================================== */}
      <section className="pt-12 sm:pt-20 pb-16 sm:pb-24 px-4 sm:px-6 max-w-5xl mx-auto text-center">
        {/* Tagline Pill */}
        <div className="inline-flex items-center rounded-full border border-purple-500/20 bg-purple-500/5 px-5 py-1.5 text-xs font-semibold text-purple-700 dark:text-purple-300 backdrop-blur-md mb-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
          <span>BUSINESS MANAGEMENT, WITHOUT THE COMPLEXITY</span>
        </div>

        {/* Hero Title */}
        <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold tracking-tight text-foreground leading-[1.12] max-w-4xl mx-auto">
          Run your business from{" "}
          <span className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-500 bg-clip-text text-transparent">
            one connected workspace
          </span>
          .
        </h1>

        {/* Subtext */}
        <p className="mt-5 text-base sm:text-lg md:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto font-normal">
          Quotations, GST invoices, multi-branch inventory, collections, and balanced ledgers.
          Engineered for daily trading operations with zero sync latency.
        </p>

        {/* CTA Area + Handwritten Arrow */}
        <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4 relative">
          <a
            href={trialMailto}
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#6D5DFB] hover:bg-[#5A4BE0] px-7 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-500/25 transition-all hover:scale-102 active:scale-98"
          >
            <span>Request 30-Day Free Trial</span>
            <ArrowRight className="h-4 w-4" />
          </a>

          <a
            href="#features"
            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-border/80 bg-card hover:bg-muted/70 px-6 py-3.5 text-sm font-semibold text-foreground transition-all hover:scale-102 active:scale-98"
          >
            <span>Explore BMS</span>
          </a>

          {/* Handwritten Annotation with Arrow */}
          <div className="hidden lg:flex items-center gap-2 absolute -right-44 top-2 select-none pointer-events-none">
            <svg
              className="w-16 h-8 text-purple-600 dark:text-purple-400"
              viewBox="0 0 70 35"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 25 C 25 35, 45 10, 65 15" />
              <path d="M58 8 L 65 15 L 60 22" />
            </svg>
            <span className="font-['Caveat',sans-serif] text-xl font-bold text-purple-600 dark:text-purple-400 -rotate-3">
              30 days to explore it.
            </span>
          </div>
        </div>

        {/* Visual Proof / UI Mockup Frame */}
        <div className="mt-12 sm:mt-16 rounded-3xl border border-purple-500/20 bg-card/60 p-2 sm:p-4 shadow-2xl backdrop-blur-md relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent z-10 pointer-events-none h-full" />
          
          {/* Top Mockup Header Bar */}
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/40 px-4 py-2.5 rounded-2xl mb-3 text-xs text-muted-foreground">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-red-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80" />
              <span className="ml-2 font-mono text-[11px] font-medium text-foreground/80">
                bms-next.workspace / central-hub
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="font-medium text-[11px]">Realtime Synced</span>
            </div>
          </div>

          {/* Mockup Dashboard Content */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-2 text-left">
            <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Today's Sales
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  ₹2,84,500
                </span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  +18.4%
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                14 Invoices · 0 pending sync
              </p>
            </div>

            <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Outstanding Collections
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  ₹1,42,120
                </span>
                <span className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                  5 Parties
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Auto-reconciled subledgers
              </p>
            </div>

            <div className="rounded-2xl border border-border/80 bg-card p-4 shadow-xs">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Branch Stock Health
              </span>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
                  98.2%
                </span>
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Optimal
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                3 Branches · Live quantities
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          2. BENEFIT STRIP
          ================================================== */}
      <section className="py-12 px-4 sm:px-6 max-w-6xl mx-auto border-y border-border/50 bg-purple-500/[0.015]">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 text-purple-600 dark:text-purple-400">
              <Zap className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Everything connected</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Quotations convert to GST invoices with one click, inventory decrements instantly, and ledgers balance automatically.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 text-purple-600 dark:text-purple-400">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Built for real operations</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Multi-branch support, offline-resilient local cache, and sub-second searching across thousands of parties and items.
              </p>
            </div>
          </div>

          <div className="flex items-start gap-3.5">
            <div className="h-9 w-9 rounded-xl bg-purple-500/10 flex items-center justify-center shrink-0 text-purple-600 dark:text-purple-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-foreground">Clear business control</h3>
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                Live cashflow, receivables age analysis, automated Indian GST breakdown, and tamper-resistant audit trails.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          3. CORE FEATURE ARCHITECTURE (EXACTLY 3 CARDS)
          ================================================== */}
      <section id="features" className="py-20 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            Engineered Workflow
          </span>
          <h2 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Three pillars of seamless daily trade.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Eliminate fragmented spreadsheets and disconnects between billing, stock, and accounting.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 sm:gap-8">
          {/* Card 1: Sales & Collections */}
          <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-7 shadow-soft flex flex-col justify-between hover:border-purple-500/40 transition-all group">
            <div>
              <div className="h-12 w-12 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5 ring-1 ring-purple-500/20 group-hover:scale-105 transition-transform">
                <Receipt className="h-6 w-6" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Pillar 01
              </span>
              <h3 className="text-lg font-bold text-foreground mt-1">
                Sales & Collections
              </h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                From quotation draft to finalized tax invoice and bank reconciliation.
              </p>

              <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>GST-compliant tax invoices & e-way bills</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Itemized discounts, HSN/SAC & tax splits</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Automated customer subledger entries</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>One-click voucher collection matching</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-5 border-t border-border/50 text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
              <span>View sales pipeline</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </div>

          {/* Card 2: Purchases & Inventory */}
          <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-7 shadow-soft flex flex-col justify-between hover:border-purple-500/40 transition-all group">
            <div>
              <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mb-5 ring-1 ring-indigo-500/20 group-hover:scale-105 transition-transform">
                <Boxes className="h-6 w-6" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                Pillar 02
              </span>
              <h3 className="text-lg font-bold text-foreground mt-1">
                Purchases & Inventory
              </h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Live inventory tracking across warehouses, retail counters, and central hubs.
              </p>

              <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Multi-branch real-time stock allocation</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Supplier purchase orders & inward bills</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Low stock threshold alerts</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Automated weighted average cost valuation</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-5 border-t border-border/50 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
              <span>Inspect inventory tracking</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </div>

          {/* Card 3: Accounts & Control */}
          <div className="rounded-3xl border border-border/80 bg-card p-6 sm:p-7 shadow-soft flex flex-col justify-between hover:border-purple-500/40 transition-all group">
            <div>
              <div className="h-12 w-12 rounded-2xl bg-purple-500/10 text-purple-600 dark:text-purple-400 flex items-center justify-center mb-5 ring-1 ring-purple-500/20 group-hover:scale-105 transition-transform">
                <BarChart3 className="h-6 w-6" />
              </div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Pillar 03
              </span>
              <h3 className="text-lg font-bold text-foreground mt-1">
                Accounts & Control
              </h3>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Authoritative double-entry bookkeeping with strict zero balance drift.
              </p>

              <ul className="mt-5 space-y-2.5 text-xs text-muted-foreground">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Automated Day Book & General Ledger</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Instant balanced Trial Balance generation</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>One-click CA Review export packages</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                  <span>Granular role & branch permissions</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-5 border-t border-border/50 text-[11px] font-semibold text-purple-600 dark:text-purple-400 flex items-center gap-1">
              <span>Review accounting engine</span>
              <ArrowRight className="h-3 w-3" />
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          4. CONNECTED BMS SECTION (6 CARDS)
          ================================================== */}
      <section id="how-it-works" className="py-20 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border/50">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            The Complete Suite
          </span>
          <h2 className="mt-2 text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
            Everything your trade operations require.
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
            Every module communicates seamlessly through a unified database schema.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <FileText className="h-8 w-8 text-purple-600 dark:text-purple-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Quotations & Invoices</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Fast drafting, PDF printing, HSN lookup, terms customization, and instant invoice conversion.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <Receipt className="h-8 w-8 text-indigo-600 dark:text-indigo-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Receipts & Payments</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Cash and bank vouchers with invoice-level matching, discount tracking, and live balance updates.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <Boxes className="h-8 w-8 text-purple-600 dark:text-purple-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Products & Inventory</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Multi-unit measurement, branch-level stock counts, reorder warnings, and categorized catalogs.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <Building2 className="h-8 w-8 text-indigo-600 dark:text-indigo-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Branches & Scoped Roles</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Partition documents and stock per branch with strict staff isolation and combined company views.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <ShieldCheck className="h-8 w-8 text-purple-600 dark:text-purple-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Indian GST & Accounts</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              CGST/SGST/IGST tax splits, automated journal generation, and audit-ready trial balances.
            </p>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-6 hover:shadow-md transition-shadow">
            <TrendingUp className="h-8 w-8 text-indigo-600 dark:text-indigo-400 mb-3" />
            <h4 className="text-base font-bold text-foreground">Business Insights</h4>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
              Daily revenue vs purchase comparisons, top customers, margin analysis, and fast financial summaries.
            </p>
          </div>
        </div>
      </section>

      {/* ==================================================
          5. MULTI-BRANCH SHOWCASE
          ================================================== */}
      <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border/50">
        <div className="rounded-3xl border border-purple-500/20 bg-gradient-to-br from-card via-card to-purple-500/5 p-8 sm:p-12 shadow-soft">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                Multi-Branch Scalability
              </span>
              <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                One company. Every branch under complete control.
              </h2>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                Whether you operate a single retail outlet or manage warehouses across multiple districts, BMS NEXT keeps your trade synchronized.
              </p>
              <div className="mt-6 space-y-3 text-xs text-muted-foreground">
                <div className="flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-purple-500" />
                  <span><strong>Owner View:</strong> Consolidated revenue, all-branch inventory, and overall company ledger.</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="h-2 w-2 rounded-full bg-indigo-500" />
                  <span><strong>Branch View:</strong> Scoped daily registers, local customer receivables, and branch-specific stock.</span>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/80 p-5 shadow-xs space-y-3">
              <div className="flex items-center justify-between text-xs pb-2 border-b border-border/50">
                <span className="font-semibold text-foreground">Branch Allocation Status</span>
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">All Nodes Active</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border/40">
                  <span className="font-medium text-foreground">Central Warehouse (Bengaluru)</span>
                  <span className="font-mono text-muted-foreground">1,420 units · Active</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border/40">
                  <span className="font-medium text-foreground">Retail Outlet 01 (Indiranagar)</span>
                  <span className="font-mono text-muted-foreground">310 units · Active</span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border/40">
                  <span className="font-medium text-foreground">Retail Outlet 02 (Koramangala)</span>
                  <span className="font-mono text-muted-foreground">285 units · Active</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          6. DATA / DEPLOYMENT SECTION
          ================================================== */}
      <section className="py-16 px-4 sm:px-6 max-w-6xl mx-auto border-t border-border/50">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 mb-3 border border-emerald-500/20">
              <Server className="h-3.5 w-3.5" />
              <span>Reliable Cloud Architecture</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-foreground">
              Offline-first resilience with instant cloud sync.
            </h2>
            <p className="mt-3 text-xs sm:text-sm text-muted-foreground leading-relaxed">
              Network dropouts won't pause your counters. Transactions cache locally in Dexie IndexedDB and seamlessly sync to Firebase the moment connection restores.
            </p>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs space-y-3">
            <h4 className="text-sm font-bold text-foreground">Enterprise Data Safeguards</h4>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Every company tenant operates inside strictly isolated database rules. Backups can be exported directly to local JSON archives at any time.
            </p>
            <div className="pt-2">
              <a
                href={trialMailto}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-[#6D5DFB] hover:text-[#5A4BE0]"
              >
                <span>Inquire about dedicated private deployment</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          7. 30-DAY FREE TRIAL SECTION (NO PRICING TABLES)
          ================================================== */}
      <section className="py-20 px-4 sm:px-6 max-w-5xl mx-auto text-center">
        <div className="rounded-3xl border border-purple-500/25 bg-gradient-to-b from-purple-500/[0.04] to-card p-8 sm:p-14 shadow-lg backdrop-blur-md relative overflow-hidden">
          <div className="max-w-2xl mx-auto">
            <BmsBrandMark size="lg" className="mx-auto mb-5" />
            <h2 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-foreground">
              Experience BMS NEXT in your business for 30 days.
            </h2>
            <p className="mt-4 text-sm text-muted-foreground leading-relaxed">
              Test real quotations, billing, and accounting with your team. Zero commitment, no card required upfront. We assist with initial setup and migration.
            </p>

            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <a
                href={trialMailto}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full bg-[#6D5DFB] hover:bg-[#5A4BE0] px-8 py-3.5 text-sm font-bold text-white shadow-lg shadow-purple-500/25 transition-all hover:scale-102 active:scale-98"
              >
                <Mail className="h-4 w-4" />
                <span>Request Your Free Trial</span>
              </a>

              <Link
                to="/contact"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-full border border-border bg-card px-6 py-3.5 text-sm font-semibold text-foreground hover:bg-muted transition-colors"
              >
                <span>Talk with Founders</span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ==================================================
          8. FAQ SECTION (ACCESSIBLE ACCORDION)
          ================================================== */}
      <section id="faq" className="py-20 px-4 sm:px-6 max-w-4xl mx-auto border-t border-border/50">
        <div className="text-center max-w-xl mx-auto mb-12">
          <span className="text-xs font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
            Frequently Asked Questions
          </span>
          <h2 className="mt-2 text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
            Clear answers to common questions.
          </h2>
        </div>

        <div className="space-y-3">
          {faqItems.map((item, index) => {
            const isOpen = openFaq === index;
            return (
              <div
                key={index}
                className="rounded-2xl border border-border/70 bg-card overflow-hidden transition-colors"
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
      </section>
    </div>
  );
}

const faqItems = [
  {
    q: "How does the 30-day free trial work?",
    a: "You get full access to all BMS NEXT features including multi-branch inventory, GST invoicing, and accounting. No credit card is required. Simply email us to get provisioned with your organization workspace.",
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
