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

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
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
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
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
      { name: "viewport", content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" },
      { name: "theme-color", content: "#1e40af" },
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
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
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
    return () => cleanupOutbox();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ActiveCompanyProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </ActiveCompanyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

