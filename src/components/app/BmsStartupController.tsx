import { useState, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useNavigate, useLocation } from "@tanstack/react-router";
import { useAuth } from "@/modules/auth/context/AuthContext";
import { useActiveCompany } from "@/modules/company/context/ActiveCompanyContext";
import { resolveAuthRoute } from "@/modules/auth/authRouting";
import { TheBalancedLedger } from "./TheBalancedLedger";
import { startupState } from "@/modules/app/startupState";

declare global {
  interface Window {
    __BMS_STARTUP_COMPLETED__?: boolean;
  }
}

export interface BmsStartupControllerProps {
  children: ReactNode;
  durationMs?: number;
  timeoutMs?: number;
}

/**
 * BMS NEXT — “THE BALANCED LEDGER” Startup Controller
 *
 * Requirements:
 * 1. Opaque surface from initial HTML/SSR output (zero UI leakage before hydration).
 * 2. Underlying route UI mounted concurrently so Firebase, Auth, Dexie, and Sync run immediately.
 * 3. Underlying route UI kept completely hidden, inert, and unavailable to screen readers during startup.
 * 4. 4.0-second visual choreography gate.
 * 5. Reveal only after BOTH animation and auth/company destination are complete:
 *    - Logged out -> /login
 *    - Logged in with company -> Dashboard (or preserves authorized deep link like /invoices)
 *    - Multiple companies -> /select-company
 *    - Platform Admin -> /system-admin
 *    - 0 companies -> /no-company-access
 * 6. Slow initialization (>4s) retains static brand composition with "Preparing your workspace…".
 * 7. Bounded recovery (>12s) provides clean recovery text and Retry action without revealing protected content.
 * 8. Window-scoped single run: internal navigations DO NOT replay startup.
 */
export function BmsStartupController({
  children,
  durationMs = 4000,
  timeoutMs = 12000,
}: BmsStartupControllerProps) {
  const [mounted, setMounted] = useState(false);
  const [isStartupActive, setIsStartupActive] = useState(true);
  const [animationDone, setAnimationDone] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isTimeout, setIsTimeout] = useState(false);
  const exitCompletedRef = useRef(false);

  const { user, authInitializing, claimsLoading, isPlatformAdmin } = useAuth();
  const { loading: companyLoading, activeCompany, companies } = useActiveCompany();
  const nav = useNavigate();
  const loc = useLocation();

  // SSR-safe client initialization
  useEffect(() => {
    setMounted(true);

    if (typeof window !== "undefined" && window.__BMS_STARTUP_COMPLETED__) {
      setIsStartupActive(false);
      return;
    }

    // Lock body scroll during startup
    if (typeof document !== "undefined") {
      document.body.style.overflow = "hidden";
    }

    // 4.0s visual choreography gate
    const timer = setTimeout(() => {
      setAnimationDone(true);
    }, durationMs);

    // 12.0s bounded recovery timeout
    const timeoutTimer = setTimeout(() => {
      setIsTimeout(true);
    }, timeoutMs);

    return () => {
      clearTimeout(timer);
      clearTimeout(timeoutTimer);
      if (typeof document !== "undefined") {
        document.body.style.overflow = "";
      }
    };
  }, [durationMs, timeoutMs]);

  // Authoritative deterministic destination resolution
  const authDestination = useMemo(() => {
    return resolveAuthRoute({
      authInitializing,
      claimsLoading,
      companiesLoading: companyLoading,
      user,
      isPlatformAdmin,
      companiesCount: companies.length,
      firstCompanyId: companies[0]?.id || null,
      activeCompanyId: activeCompany?.id || null,
    });
  }, [
    authInitializing,
    claimsLoading,
    companyLoading,
    user,
    isPlatformAdmin,
    companies,
    activeCompany,
  ]);

  // Dual gate: wait for BOTH 4.0s animation completion AND destination resolution
  useEffect(() => {
    if (!mounted || !isStartupActive || isExiting || exitCompletedRef.current) return;

    if (animationDone && authDestination.type !== "waiting") {
      setIsExiting(true);

      // Determine target destination and preserve valid authorized deep links
      let targetPath: string;
      if (authDestination.type === "dashboard") {
        const isAppSubRoute =
          loc.pathname !== "/login" &&
          loc.pathname !== "/select-company" &&
          loc.pathname !== "/no-company-access" &&
          loc.pathname !== "/platform-admin-setup-required";

        targetPath = isAppSubRoute && loc.pathname !== "/" ? loc.pathname : "/";
      } else {
        targetPath = authDestination.to;
      }

      // Route transition if needed
      if (loc.pathname !== targetPath) {
        nav({ to: targetPath as any, replace: true });
      }

      // Mark client window completed
      if (typeof window !== "undefined") {
        window.__BMS_STARTUP_COMPLETED__ = true;
      }

      startupState.markCompleted();

      // Allow 350ms exit fade
      const exitTimer = setTimeout(() => {
        exitCompletedRef.current = true;
        setIsStartupActive(false);
        setIsExiting(false);
        if (typeof document !== "undefined") {
          document.body.style.overflow = "";
        }
      }, 350);

      return () => clearTimeout(exitTimer);
    }
  }, [
    mounted,
    isStartupActive,
    isExiting,
    animationDone,
    authDestination,
    loc.pathname,
    nav,
  ]);

  const handleRetry = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const isExtended = animationDone && authDestination.type === "waiting";

  return (
    <>
      {/* 100% OPAQUE STARTUP SURFACE
          Covers viewport from initial SSR / first-paint with zero UI bleed-through */}
      {isStartupActive && (
        <TheBalancedLedger
          isExiting={isExiting}
          isExtended={isExtended}
          isTimeout={isTimeout}
          onRetry={handleRetry}
        />
      )}

      {/* UNDERLYING APPLICATION
          Kept mounted concurrently so auth, Dexie, active company, and sync listeners
          run from T=0 without deadlock.
          When startup is active: completely hidden, inert, untabbable, and non-accessible.
          When startup completes: fully active, accessible, and visible with zero layout shift. */}
      <div
        aria-hidden={isStartupActive ? "true" : undefined}
        inert={isStartupActive ? true : undefined}
        style={{
          visibility: isStartupActive && !isExiting ? "hidden" : "visible",
          pointerEvents: isStartupActive ? "none" : "auto",
        }}
      >
        {children}
      </div>
    </>
  );
}
