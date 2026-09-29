import { Link } from "@tanstack/react-router";
import { Mail, ArrowUpRight } from "lucide-react";
import { BmsBrandLockup } from "@/components/brand/BmsBrandLockup";
import { AssociatedBrands } from "@/components/brand/AssociatedBrands";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

export function MarketingFooter() {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="border-t border-border/60 bg-gradient-to-b from-transparent via-purple-500/[0.015] to-purple-500/[0.03] pt-14 pb-12 mt-20">
      <div className="mx-auto w-full max-w-6xl px-6">
        {/* Main Grid: Brand Lockup + Nav Links */}
        <div className="grid grid-cols-1 gap-10 md:grid-cols-12 lg:gap-12 pb-12 border-b border-border/50">
          {/* Left Column: Full BMS Lockup & Vision */}
          <div className="md:col-span-5 flex flex-col items-start gap-4">
            <Link to="/" aria-label="BMS NEXT Home" className="transition-transform hover:scale-101">
              <BmsBrandLockup size="lg" />
            </Link>
            <p className="text-sm text-muted-foreground leading-relaxed max-w-sm mt-1">
              Connected business operations for growing teams. Quotations, GST billing, multi-branch inventory, and synchronized ledgers in one fast workspace.
            </p>
            <div className="inline-flex items-center rounded-full border border-border/60 bg-card/60 px-3.5 py-1.5 text-xs text-muted-foreground mt-1">
              <span>Engineered for Indian Businesses</span>
            </div>
          </div>

          {/* Middle Columns: Product & Legal */}
          <div className="md:col-span-4 grid grid-cols-2 gap-8">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-4">
                Product
              </h3>
              <ul className="space-y-2.5 text-xs text-muted-foreground font-medium">
                <li>
                  <a href="/#features" className="hover:text-foreground transition-colors">
                    Features
                  </a>
                </li>
                <li>
                  <a href="/#how-it-works" className="hover:text-foreground transition-colors">
                    How It Works
                  </a>
                </li>
                <li>
                  <Link to="/about" className="hover:text-foreground transition-colors">
                    About
                  </Link>
                </li>
                <li>
                  <Link to="/faq" className="hover:text-foreground transition-colors">
                    FAQ
                  </Link>
                </li>
                <li>
                  <Link to="/login" className="hover:text-foreground transition-colors">
                    Sign In
                  </Link>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-4">
                Legal & Support
              </h3>
              <ul className="space-y-2.5 text-xs text-muted-foreground font-medium">
                <li>
                  <Link to="/privacy" className="hover:text-foreground transition-colors">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className="hover:text-foreground transition-colors">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/contact" className="hover:text-foreground transition-colors">
                    Contact Us
                  </Link>
                </li>
              </ul>
            </div>
          </div>

          {/* Right Column: Contact & Direct Inquiries */}
          <div className="md:col-span-3 flex flex-col items-start gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">
              Get in Touch
            </h3>
            <p className="text-xs text-muted-foreground">
              Questions regarding deployment, multi-branch setups, or trial onboarding:
            </p>
            <a
              href={`mailto:${PUBLIC_SUPPORT_EMAIL}`}
              className="inline-flex items-center gap-2 rounded-xl border border-border/80 bg-card px-3.5 py-2 text-xs font-semibold text-foreground hover:border-purple-500/50 hover:bg-purple-500/5 transition-all group"
            >
              <Mail className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
              <span>{PUBLIC_SUPPORT_EMAIL}</span>
              <ArrowUpRight className="h-3 w-3 text-muted-foreground group-hover:text-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </a>
          </div>
        </div>

        {/* Association Area + Bottom Bar */}
        <div className="pt-8 flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          {/* Associated with ONYIIX & Discuss */}
          <AssociatedBrands />

          {/* Copyright notice */}
          <div className="text-xs text-muted-foreground/80 md:text-right">
            <p>© {currentYear} BMS NEXT. All rights reserved.</p>
            <p className="text-[11px] mt-0.5">Designed with precision for seamless day-to-day trade.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
