import { Link } from "@tanstack/react-router";
import { Mail } from "lucide-react";
import type { ReactNode } from "react";
import logo from "@/assets/bms-logo.png.asset.json";
import { PUBLIC_SUPPORT_EMAIL, BRAND_ATTRIBUTION, BRAND_TAGLINE } from "@/config/publicConfig";

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-slate-50 via-sky-50/40 to-slate-100 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950">
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-3.5">
          <Link to="/" className="flex items-center gap-3">
            <img src={logo.url} alt="BMS logo" className="h-9 w-9 rounded-lg object-contain shadow-sm ring-1 ring-border/50" />
            <div className="flex flex-col">
              <span className="font-semibold tracking-tight text-foreground leading-none">BMS NEXT</span>
              <span className="text-[10px] text-muted-foreground font-medium tracking-wide">by {BRAND_ATTRIBUTION}</span>
            </div>
          </Link>
          <nav className="flex items-center gap-1.5 text-sm font-medium">
            <Link
              to="/about"
              className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              activeProps={{ className: "rounded-lg px-3 py-1.5 bg-accent/80 text-foreground" }}
            >
              About
            </Link>
            <Link
              to="/contact"
              className="rounded-lg px-3 py-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              activeProps={{ className: "rounded-lg px-3 py-1.5 bg-accent/80 text-foreground" }}
            >
              Contact
            </Link>
            <Link
              to="/login"
              className="ml-2 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90"
            >
              Sign in
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">{children}</main>
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
