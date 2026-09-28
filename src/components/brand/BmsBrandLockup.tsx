import { cn } from "@/lib/utils";

interface BmsBrandLockupProps {
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  alt?: string;
}

const sizeClasses = {
  sm: "h-8 max-w-[180px]",
  md: "h-11 max-w-[240px]",
  lg: "h-14 max-w-[320px]",
  xl: "h-20 max-w-[440px]",
};

/**
 * BMS Full Brand Lockup (Variant B) — Cube symbol + "BMS NEXT — BUSINESS ERP —"
 * Used selectively for:
 * - Public website footer
 * - Company Settings informational footer
 * - About / Product identity sections
 * Automatically switches between light mode and dark mode transparent assets.
 */
export function BmsBrandLockup({
  className,
  size = "md",
  alt = "BMS NEXT — Business Management System",
}: BmsBrandLockupProps) {
  return (
    <div className={cn("relative inline-flex items-center shrink-0", className)}>
      {/* Light mode lockup (dark text) */}
      <img
        src="/brand/bms/bms-lockup.png"
        alt={alt}
        className={cn("w-auto object-contain dark:hidden transition-transform duration-200", sizeClasses[size])}
        loading="eager"
        decoding="async"
      />
      {/* Dark mode lockup (white text) */}
      <img
        src="/brand/bms/bms-lockup-white.png"
        alt={alt}
        className={cn("w-auto object-contain hidden dark:block transition-transform duration-200", sizeClasses[size])}
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
