import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "sonner";
import { AuthProvider } from "@/modules/auth/context/AuthContext";
import { ActiveCompanyProvider } from "@/modules/company/context/ActiveCompanyContext";
import { outboxManager } from "@/modules/sync/outboxManager";
import { BmsStartupController } from "@/components/app/BmsStartupController";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 text-center shadow-soft">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-foreground/80">
          <span className="text-xl font-bold font-mono">404</span>
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The requested page doesn't exist or has moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Back to Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: unknown; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error as Error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border border-border/80 bg-card p-8 text-center shadow-soft">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <span className="text-lg font-bold">!</span>
        </div>
        <h1 className="mt-4 text-lg font-semibold tracking-tight text-foreground">
          Unable to load this page
        </h1>
        <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
          An unexpected display issue occurred. You can retry safely without losing saved records.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs transition-all hover:bg-primary/90 active:scale-[0.98]"
          >
            Retry
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground shadow-xs transition-all hover:bg-muted active:scale-[0.98]"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { name: "theme-color", content: "#F4F6F3" },
      { title: "BMS NEXT — Business Management System" },
      { name: "description", content: "Connected cloud business management software for quotations, GST invoices, receipts, purchases, ledgers and reports. Built by MMA." },
      { name: "author", content: "MMA" },
      { name: "keywords", content: "business management, GST invoice, quotation, receipt, purchase, ledger, accounting, MMA, BMS NEXT" },
      { property: "og:site_name", content: "BMS NEXT — Business Management System" },
      { property: "og:title", content: "BMS NEXT — Business Management System" },
      { property: "og:description", content: "Connected cloud business management software for quotations, GST invoices, receipts, purchases, ledgers and reports. Built by MMA." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "BMS NEXT — Business Management System" },
      { name: "twitter:description", content: "Connected cloud business management software for quotations, GST invoices, receipts, purchases, ledgers and reports. Built by MMA." },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "BMS NEXT" },
      { name: "apple-mobile-web-app-status-bar-style", content: "default" },
      { name: "mobile-web-app-capable", content: "yes" },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2f1eca7b-8de2-405c-8035-d89ad78c42f5/id-preview-caba5a68--f0e62c59-1b8b-4b2c-b902-d17079cdaf58.lovable.app-1783453882268.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2f1eca7b-8de2-405c-8035-d89ad78c42f5/id-preview-caba5a68--f0e62c59-1b8b-4b2c-b902-d17079cdaf58.lovable.app-1783453882268.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Caveat:wght@600;700&family=Dancing+Script:wght@600;700&family=Great+Vibes&family=Inter:wght@400;500;600;700;800&display=swap" },
      { rel: "icon", type: "image/png", href: "/favicon.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "BMS NEXT — Business Management System",
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          description: "Connected cloud business management software for quotations, GST invoices, receipts, purchases, ledgers and reports.",
          author: { "@type": "Organization", name: "MMA" },
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("bms_theme")||"light";if(t==="dark"){document.documentElement.classList.add("dark");}else{document.documentElement.classList.remove("dark");}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-accent selection:text-accent-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  useEffect(() => {
    const theme = (typeof window !== "undefined" && localStorage.getItem("bms_theme")) || "light";
    document.documentElement.classList.toggle("dark", theme === "dark");

    // Initialize connectivity listener & outbox sync
    const cleanupOutbox = outboxManager.init();

    // Register PWA service worker
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          console.warn("[SW] Registration error:", err);
        });
      });
    }

    return () => cleanupOutbox();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActiveCompanyProvider>
          <BmsStartupController>
            <Outlet />
          </BmsStartupController>
          <Toaster richColors position="top-right" />
        </ActiveCompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

