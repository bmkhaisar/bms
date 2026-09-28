import { cn } from "@/lib/utils";

interface BmsBrandMarkProps {
  className?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}

const sizeClasses = {
  xs: "h-6 w-6",
  sm: "h-8 w-8",
  md: "h-10 w-10",
  lg: "h-14 w-14",
  xl: "h-20 w-20",
};

/**
 * BMS Symbol (Variant A) — Compact isometric cube icon mark.
 * Used for:
 * - Public floating navbar
 * - Compact mobile navigation
 * - Login page header
 * - Favicon and loading states
 * Automatically adapts between dark & light modes.
 */
export function BmsBrandMark({ className, size = "md" }: BmsBrandMarkProps) {
  return (
    <div className={cn("relative inline-flex items-center justify-center shrink-0", sizeClasses[size], className)}>
      {/* Light mode symbol */}
      <img
        src="/brand/bms/bms-symbol-cropped.png"
        alt="BMS NEXT"
        className="h-full w-full object-contain dark:hidden transition-transform duration-200"
        loading="eager"
        decoding="async"
      />
      {/* Dark mode symbol */}
      <img
        src="/brand/bms/bms-symbol-white.png"
        alt="BMS NEXT"
        className="h-full w-full object-contain hidden dark:block transition-transform duration-200"
        loading="eager"
        decoding="async"
      />
    </div>
  );
}
