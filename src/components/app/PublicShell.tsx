import { Link } from "@tanstack/react-router";
import { Mail, Moon, Sun } from "lucide-react";
import { useState, useEffect, type ReactNode } from "react";
import logo from "@/assets/bms-logo.png.asset.json";
import { PUBLIC_SUPPORT_EMAIL, BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";
import { Button } from "@/components/ui/button";

export function PublicShell({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("bms_theme") === "dark";
    setDark(t);
    document.documentElement.classList.toggle("dark", t);
  }, []);

  function toggleTheme() {
    const next = !dark;
    setDark(next);
    localStorage.setItem("bms_theme", next ? "dark" : "light");
    document.documentElement.classList.toggle("dark", next);
  }

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-accent selection:text-accent-foreground">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-card/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <img src={logo.url} alt="BMS logo" className="h-9 w-9 rounded-xl object-contain shadow-xs border border-border/60 bg-card p-0.5" />
            <div className="flex flex-col">
              <span className="font-semibold tracking-tight text-foreground text-sm leading-none">BMS NEXT</span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wide">by {BRAND_ATTRIBUTION}</span>
            </div>
          </Link>
          <nav className="flex items-center gap-2 text-xs font-medium">
            <Link
              to="/about"
              className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "rounded-lg px-3 py-1.5 bg-secondary font-semibold text-foreground" }}
            >
              About
            </Link>
            <Link
              to="/contact"
              className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              activeProps={{ className: "rounded-lg px-3 py-1.5 bg-secondary font-semibold text-foreground" }}
            >
              Contact
            </Link>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label="Toggle theme"
            >
              {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
            <Link
              to="/login"
              className="ml-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-[0.98]"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      <PublicFooter />
    </div>
  );
}

export function PublicFooter() {
  return (
    <footer className="border-t border-border/50 bg-background/50 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-6 py-5 text-xs text-muted-foreground sm:flex-row">
        <div className="flex items-center gap-2">
          <Mail className="h-3.5 w-3.5 text-muted-foreground" />
          <a href={`mailto:${PUBLIC_SUPPORT_EMAIL}`} className="transition-colors hover:text-foreground">
            {PUBLIC_SUPPORT_EMAIL}
          </a>
        </div>
        <div className="flex items-center gap-2">
          <span>{BRAND_TAGLINE}</span>
        </div>
      </div>
    </footer>
  );
}
