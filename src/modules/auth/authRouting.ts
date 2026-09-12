import { SUPERSEDED_LEGACY_UID } from "@/config/publicConfig";

export type AuthDestination =
  | { type: "redirect"; to: "/login" }
  | { type: "redirect"; to: "/platform-admin-setup-required" }
  | { type: "redirect"; to: "/system-admin" }
  | { type: "redirect"; to: "/no-company-access" }
  | { type: "redirect"; to: "/select-company" }
  | { type: "dashboard"; to: "/"; companyId: string }
  | { type: "waiting"; reason: "initializingAuth" | "loadingClaims" | "resolvingCompanies" };

export interface ResolveAuthRouteParams {
  authInitializing: boolean;
  claimsLoading: boolean;
  companiesLoading: boolean;
  user: { uid: string; email?: string | null } | null;
  isPlatformAdmin: boolean;
  companiesCount: number;
  firstCompanyId?: string | null;
  activeCompanyId?: string | null;
  setupRequired?: boolean;
}

/**
 * Deterministic Authentication Resolution Matrix
 * 
 * Priority:
 * 1. Wait until auth state AND custom claims are fully resolved.
 * 2. If unauthenticated -> /login.
 * 3. If server-verified setup status requires bootstrap -> /platform-admin-setup-required.
 * 4. CASE A — Platform Admin (claims.platformAdmin === true) -> /system-admin (even with 0 companies).
 * 5. Wait until company memberships finish resolving for normal users.
 * 6. CASE B — Normal user with 0 active companies -> /no-company-access.
 * 7. CASE C — Normal user with exactly 1 active company -> company dashboard (/).
 * 8. CASE D — Normal user with >1 active companies -> /select-company (pure selector).
 */
export function resolveAuthRoute(params: ResolveAuthRouteParams): AuthDestination {
  if (params.authInitializing) {
    return { type: "waiting", reason: "initializingAuth" };
  }

  if (!params.user) {
    return { type: "redirect", to: "/login" };
  }

  if (params.claimsLoading) {
    return { type: "waiting", reason: "loadingClaims" };
  }

  // Strictly block superseded legacy UID from platform admin or unassigned login
  if (params.user.uid === SUPERSEDED_LEGACY_UID) {
    if (params.isPlatformAdmin || params.companiesCount === 0) {
      return { type: "redirect", to: "/login" };
    }
  }

  // Setup condition: Authenticated user matches server-configured admin UID but lacks platformAdmin claim
  if (params.setupRequired && !params.isPlatformAdmin) {
    return { type: "redirect", to: "/platform-admin-setup-required" };
  }

  // CASE A — PLATFORM ADMIN: default landing is /system-admin (even with 0 companies)
  if (params.isPlatformAdmin) {
    return { type: "redirect", to: "/system-admin" };
  }

  // Normal users wait for company resolution
  if (params.companiesLoading) {
    return { type: "waiting", reason: "resolvingCompanies" };
  }

  // CASE B — Normal user with 0 companies
  if (params.companiesCount === 0) {
    return { type: "redirect", to: "/no-company-access" };
  }

  // CASE C — Normal user with 1 company
  if (params.companiesCount === 1) {
    return {
      type: "dashboard",
      to: "/",
      companyId: params.firstCompanyId || "",
    };
  }

  // CASE D — Normal user with >1 companies
  return { type: "redirect", to: "/select-company" };
}
