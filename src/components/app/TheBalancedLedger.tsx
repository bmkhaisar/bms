import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "framer-motion";
import logo from "@/assets/bms-logo.png.asset.json";

export interface TheBalancedLedgerProps {
  isExiting?: boolean;
  isExtended?: boolean;
  isTimeout?: boolean;
  onRetry?: () => void;
}

/**
 * “THE BALANCED LEDGER” — BMS NEXT Startup Animation
 *
 * Choreography:
 * 0.0s - 0.5s: Opaque brand background (#FFFFFF -> #EFF7FF). Delicate ledger outline appears.
 * 0.5s - 1.5s: Three paired rows of pale-blue ledger strokes move symmetrically 8-12px.
 * 1.5s - 2.3s: Columns settle into alignment; classic double accounting underline draws beneath.
 * 2.3s - 3.2s: Ledger artwork fades away; BMS logo, "BMS NEXT", and supporting line emerge.
 * 3.2s - 4.0s: Completed brand composition holds; prepares clean reveal to resolved destination.
 * 4.0s+ (slow): Retains static brand composition; displays "Preparing your workspace…".
 * 12.0s+ (timeout): Displays bounded recovery message with "Retry" action.
 */
export function TheBalancedLedger({
  isExiting = false,
  isExtended = false,
  isTimeout = false,
  onRetry,
}: TheBalancedLedgerProps) {
  const shouldReduceMotion = useReducedMotion();

  // Internal visual stage tracking for strict choreography (0 to 4 seconds)
  // Stage 1: 0.0s - 0.5s (Ledger outline appears)
  // Stage 2: 0.5s - 1.5s (Paired strokes move symmetrically)
  // Stage 3: 1.5s - 2.3s (Double underline draws)
  // Stage 4: 2.3s - 3.2s (Transition: ledger fades, brand emerges)
  // Stage 5: 3.2s - 4.0s (Brand hold)
  const [stage, setStage] = useState<number>(shouldReduceMotion ? 4 : 1);

  useEffect(() => {
    if (shouldReduceMotion) {
      setStage(4);
      return;
    }

    const t2 = setTimeout(() => setStage(2), 500);
    const t3 = setTimeout(() => setStage(3), 1500);
    const t4 = setTimeout(() => setStage(4), 2300);
    const t5 = setTimeout(() => setStage(5), 3200);

    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
      clearTimeout(t5);
    };
  }, [shouldReduceMotion]);

  const showLedgerArtwork = !shouldReduceMotion && stage < 4;
  const showBrandComposition = shouldReduceMotion || stage >= 4;

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center select-none overflow-hidden bg-gradient-to-b from-[#FFFFFF] to-[#EFF7FF] p-4 transition-opacity duration-350"
      style={{
        height: "100dvh",
        minHeight: "100vh",
        paddingTop: "max(1.5rem, env(safe-area-inset-top, 1.5rem))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 1.5rem))",
        opacity: isExiting ? 0 : 1,
        pointerEvents: isExiting ? "none" : "auto",
      }}
      aria-live="polite"
      aria-busy={!isExiting}
      role="status"
    >
      <div className="w-full max-w-[320px] flex flex-col items-center justify-center text-center">
        {/* ==================================================================== */}
        {/* STAGES 1 - 3: THE BALANCED LEDGER ARTWORK (0.0s - 2.3s)              */}
        {/* ==================================================================== */}
        {showLedgerArtwork && (
          <motion.div
            key="ledger-artwork"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{
              opacity: stage >= 4 ? 0 : 1,
              scale: 1,
            }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="w-[230px] h-[142px] rounded-2xl border border-[#006BCB]/20 bg-white/90 shadow-xs relative flex flex-col overflow-hidden p-3"
          >
            {/* Ledger Header Rule with Debit/Credit Column Marks */}
            <div className="h-[24px] border-b border-[#006BCB]/15 flex items-center justify-between px-3">
              <span className="font-mono text-[9px] font-semibold text-[#006BCB]/60 tracking-wider">
                DR
              </span>
              <span className="font-mono text-[9px] font-semibold text-[#006BCB]/60 tracking-wider">
                CR
              </span>
            </div>

            {/* Symmetrical Double-Entry Center Vertical Rule */}
            <div className="absolute top-[36px] bottom-3 left-1/2 w-px -translate-x-1/2 bg-[#006BCB]/15" />

            {/* Three Paired Rows of Pale-Blue Ledger Strokes (0.5s - 1.5s) */}
            <div className="flex-1 flex flex-col justify-center space-y-3 px-1 pt-1">
              {/* Row 1 */}
              <div className="flex items-center justify-between">
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: -10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[56px] rounded-full bg-[#006BCB]/25"
                />
                <motion.div
                  initial={{ x: 10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: 10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[50px] rounded-full bg-[#006BCB]/25"
                />
              </div>

              {/* Row 2 */}
              <div className="flex items-center justify-between">
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: -10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[46px] rounded-full bg-[#006BCB]/25"
                />
                <motion.div
                  initial={{ x: 10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: 10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[54px] rounded-full bg-[#006BCB]/25"
                />
              </div>

              {/* Row 3 */}
              <div className="flex items-center justify-between">
                <motion.div
                  initial={{ x: -10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: -10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[52px] rounded-full bg-[#006BCB]/25"
                />
                <motion.div
                  initial={{ x: 10, opacity: 0 }}
                  animate={stage >= 2 ? { x: 0, opacity: 1 } : { x: 10, opacity: 0 }}
                  transition={{ duration: 0.55, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
                  className="h-[3px] w-[48px] rounded-full bg-[#006BCB]/25"
                />
              </div>
            </div>

            {/* Classic Double Accounting Underline (1.5s - 2.3s) */}
            <div className="pt-1.5 px-2">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={stage >= 3 ? { scaleX: 1 } : { scaleX: 0 }}
                transition={{ duration: 0.65, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: "center" }}
                className="w-full space-y-[2px]"
              >
                <div className="h-[1px] w-full bg-[#006BCB]/35" />
                <div className="h-[1.5px] w-full bg-[#006BCB]/70" />
              </motion.div>
            </div>
          </motion.div>
        )}

        {/* ==================================================================== */}
        {/* STAGES 4 - 5: THE COMPLETED BRAND COMPOSITION (2.3s - 4.0s+)          */}
        {/* ==================================================================== */}
        {showBrandComposition && (
          <motion.div
            key="brand-composition"
            initial={shouldReduceMotion ? { opacity: 1 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col items-center text-center"
          >
            {/* Existing BMS Logo Mark */}
            <div className="h-16 w-16 rounded-2xl bg-white p-2.5 shadow-xs border border-[#E1EFFF] flex items-center justify-center">
              <img
                src={logo.url}
                alt="BMS NEXT Logo"
                className="h-full w-full object-contain"
              />
            </div>

            {/* Wordmark: Deep Navy #102A43 */}
            <h1 className="mt-3.5 text-2xl font-bold tracking-tight text-[#102A43]">
              BMS NEXT
            </h1>

            {/* Supporting Line: Slate #486581 */}
            <p className="mt-1 text-xs font-medium text-[#486581] tracking-wide">
              Clarity for every transaction.
            </p>

            {/* Slow Loading State (> 4s): Clean Non-Invented Status */}
            {isExtended && !isTimeout && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3 }}
                className="mt-4 text-xs font-medium text-[#627D98]"
              >
                Preparing your workspace…
              </motion.p>
            )}

            {/* Bounded Recovery State (> 12s): Clear Recovery Action */}
            {isTimeout && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-4 flex flex-col items-center space-y-2.5"
              >
                <p className="text-xs text-[#627D98] max-w-[260px] leading-relaxed">
                  Connecting to your workspace is taking longer than usual.
                </p>
                <button
                  type="button"
                  onClick={onRetry || (() => window.location.reload())}
                  className="inline-flex items-center justify-center rounded-lg bg-[#006BCB] px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-[#0058A8] focus:outline-none focus:ring-2 focus:ring-[#006BCB]/30 active:scale-[0.98]"
                >
                  Retry
                </button>
              </motion.div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}
