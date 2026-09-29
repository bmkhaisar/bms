import { Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Moon, Sun, ArrowRight, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BmsBrandMark } from "@/components/brand/BmsBrandMark";
import { PUBLIC_SUPPORT_EMAIL } from "@/config/publicConfig";

interface MarketingHeaderProps {
  className?: string;
}

export function MarketingHeader({ className }: MarketingHeaderProps) {
  const [dark, setDark] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const isDark =
      localStorage.getItem("bms_theme") === "dark" ||
      document.documentElement.classList.contains("dark");
    setDark(isDark);
  }, []);

  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 20);
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("bms_theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  const trialMailto = `mailto:${PUBLIC_SUPPORT_EMAIL}?subject=BMS%20NEXT%2030-Day%20Free%20Trial%20Request&body=Hi%20Maaz,%0D%0A%0D%0AI%20would%20like%20to%20request%20a%2030-day%20free%20trial%20for%20BMS%20NEXT.%0D%0A%0D%0ACompany%20Name:%0D%0AContact%20Person:%0D%0APhone:%0D%0ANumber%20of%20Branches:`;

  return (
    <header className="sticky top-3 sm:top-5 z-50 px-4 sm:px-6 w-full max-w-6xl mx-auto">
      <div
        className={`flex items-center justify-between rounded-full border border-border/70 bg-card/85 px-4 sm:px-6 py-2.5 sm:py-3 shadow-lg backdrop-blur-xl transition-all duration-300 ${
          scrolled ? "shadow-purple-500/5 border-purple-500/20" : ""
        } ${className || ""}`}
      >
        {/* Brand Left: Variant A Compact Symbol + Typography */}
        <Link
          to="/"
          className="flex items-center gap-2.5 transition-transform hover:scale-102 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label="BMS NEXT Home"
        >
          <BmsBrandMark size="sm" />
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold tracking-tight text-base text-foreground">
              BMS NEXT
            </span>
            <span className="hidden sm:inline-flex items-center rounded-full bg-purple-500/10 px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400 border border-purple-500/20">
              ERP
            </span>
          </div>
        </Link>

        {/* Center Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 text-xs font-semibold text-muted-foreground">
          <a
            href="/#features"
            className="rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground hover:bg-muted/60"
          >
            Features
          </a>
          <a
            href="/#how-it-works"
            className="rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground hover:bg-muted/60"
          >
            How It Works
          </a>
          <Link
            to="/about"
            className="rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground hover:bg-muted/60"
          >
            About
          </Link>
          <Link
            to="/faq"
            className="rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground hover:bg-muted/60"
          >
            FAQ
          </Link>
          <Link
            to="/contact"
            className="rounded-full px-3.5 py-1.5 transition-colors hover:text-foreground hover:bg-muted/60"
          >
            Contact
          </Link>
        </nav>

        {/* Right Desktop Actions */}
        <div className="hidden md:flex items-center gap-2.5">
          {/* Theme Toggle */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/70"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-neutral-600" />}
          </Button>

          {/* Sign In */}
          <Link
            to="/login"
            className="rounded-full px-3.5 py-1.5 text-xs font-semibold text-foreground hover:bg-muted/70 transition-colors"
          >
            Sign in
          </Link>

          {/* Request 30-Day Free Trial CTA */}
          <a
            href={trialMailto}
            className="inline-flex items-center gap-1.5 rounded-full bg-[#6D5DFB] hover:bg-[#5C4CE5] px-4 py-2 text-xs font-bold text-white shadow-sm shadow-purple-500/20 transition-all hover:scale-102 active:scale-98"
          >
            <span>Request Free Trial</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </div>

        {/* Mobile Hamburger Button */}
        <div className="flex md:hidden items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground"
            aria-label="Toggle theme"
          >
            {dark ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4" />}
          </Button>

          <Button
            variant="ghost"
            size="icon"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="h-8 w-8 rounded-full text-foreground"
            aria-label="Toggle mobile menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="md:hidden mt-2 rounded-2xl border border-border/80 bg-card/95 p-5 shadow-xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex flex-col gap-3 text-sm font-semibold text-foreground">
            <a
              href="/#features"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              Features
            </a>
            <a
              href="/#how-it-works"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              How It Works
            </a>
            <Link
              to="/about"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              About
            </Link>
            <Link
              to="/faq"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              FAQ
            </Link>
            <Link
              to="/contact"
              onClick={() => setMobileMenuOpen(false)}
              className="px-3 py-2 rounded-lg hover:bg-muted/60 transition-colors"
            >
              Contact
            </Link>

            <div className="h-px w-full bg-border/60 my-1" />

            <div className="flex flex-col gap-2 pt-1">
              <Link
                to="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center py-2.5 rounded-xl border border-border bg-card font-semibold text-xs hover:bg-muted transition-colors"
              >
                Sign in to Workspace
              </Link>
              <a
                href={trialMailto}
                className="w-full text-center py-2.5 rounded-xl bg-[#6D5DFB] hover:bg-[#5C4CE5] font-bold text-xs text-white shadow-sm transition-transform active:scale-98"
              >
                Request 30-Day Free Trial
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
