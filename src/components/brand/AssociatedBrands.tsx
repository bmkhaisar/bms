import { cn } from "@/lib/utils";

interface AssociatedBrandsProps {
  className?: string;
  layout?: "horizontal" | "vertical";
}

/**
 * Associated Brands Block — Exclusively for Public Footer
 * Displays ONYIIX and Discuss using precise typography, colors, and branding.
 * - ONYIIX -> https://onyiix.com/
 * - Discuss -> https://www.discussit.in/
 * Strictly excluded from invoices, PDFs, ERP navigation, and login.
 */
export function AssociatedBrands({ className, layout = "horizontal" }: AssociatedBrandsProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3",
        className
      )}
    >
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
        Associated with
      </span>
      <div
        className={cn(
          "flex items-center gap-6 sm:gap-8 flex-wrap",
          layout === "vertical" && "flex-col items-start gap-4"
        )}
      >
        {/* ONYIIX Brand Link */}
        <a
          href="https://onyiix.com/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="ONYIIX — Design • Build • Deliver (opens in new tab)"
          className="group relative inline-flex flex-col items-center justify-center rounded-xl px-3 py-1.5 transition-all duration-200 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2"
        >
          <div className="flex items-baseline font-sans font-extrabold tracking-[0.22em] text-lg sm:text-xl text-foreground">
            <span>ONYII</span>
            <span className="bg-gradient-to-b from-neutral-200 via-neutral-400 to-neutral-600 bg-clip-text text-transparent font-black drop-shadow-xs dark:from-white dark:via-neutral-200 dark:to-neutral-400">
              X
            </span>
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 w-full justify-center">
            <span className="h-[1px] w-3 bg-border/80" />
            <span className="text-[8px] font-bold tracking-[0.26em] text-muted-foreground uppercase leading-none">
              DESIGN • BUILD • DELIVER
            </span>
            <span className="h-[1px] w-3 bg-border/80" />
          </div>
        </a>

        {/* Discuss Brand Link */}
        <a
          href="https://www.discussit.in/"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Discuss (opens in new tab)"
          className="group inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 transition-all duration-200 hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2"
        >
          {/* Red opening angle bracket */}
          <span className="font-mono text-2xl font-black text-[#EF4444] transition-transform duration-200 group-hover:-translate-x-0.5">
            &lt;
          </span>
          {/* Handwritten-feel wordmark */}
          <span className="font-serif italic font-black text-xl sm:text-2xl tracking-tight text-foreground px-0.5 font-['Caveat',sans-serif]">
            Discuss
          </span>
          {/* Blue slash & closing angle bracket */}
          <span className="font-mono text-2xl font-black text-[#0284C7] transition-transform duration-200 group-hover:translate-x-0.5">
            /&gt;
          </span>
        </a>
      </div>
    </div>
  );
}
