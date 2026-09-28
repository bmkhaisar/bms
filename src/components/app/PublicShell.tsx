import { type ReactNode } from "react";
import { MarketingHeader } from "@/components/marketing/MarketingHeader";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export interface PublicShellProps {
  children: ReactNode;
  showHeader?: boolean;
  showFooter?: boolean;
}

/**
 * PublicShell — Used exclusively for unauthenticated public marketing pages:
 * - / (Public Landing)
 * - /about
 * - /faq
 * - /terms
 * - /privacy
 * - /contact
 * 
 * Never wraps authenticated ERP pages (/invoices, /purchases, etc.).
 */
export function PublicShell({
  children,
  showHeader = true,
  showFooter = true,
}: PublicShellProps) {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground selection:bg-purple-500/20 selection:text-purple-900 dark:selection:text-purple-200">
      {showHeader && <MarketingHeader />}
      <main className="flex-1 w-full">{children}</main>
      {showFooter && <MarketingFooter />}
    </div>
  );
}

export { MarketingFooter as PublicFooter };
