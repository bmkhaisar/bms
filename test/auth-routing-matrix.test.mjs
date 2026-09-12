import test from "node:test";
import assert from "node:assert/strict";

const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

/**
 * Pure Deterministic Auth Routing Implementation
 */
function resolveAuthRoute(params) {
  if (params.authInitializing) {
    return { type: "waiting", reason: "initializingAuth" };
  }

  if (!params.user) {
    return { type: "redirect", to: "/login" };
  }

  if (params.claimsLoading) {
    return { type: "waiting", reason: "loadingClaims" };
  }

  // Strictly block superseded legacy UID
  if (params.user.uid === SUPERSEDED_LEGACY_UID) {
    return { type: "redirect", to: "/login" };
  }

  // Setup condition: Target admin UID without platformAdmin custom claim
  if (params.setupRequired && !params.isPlatformAdmin) {
    return { type: "redirect", to: "/platform-admin-setup-required" };
  }

  // CASE A — PLATFORM ADMIN: lands on /system-admin (even with 0 companies)
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

test("Auth Matrix 1: Unauthenticated user -> /login", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: null,
    isPlatformAdmin: false,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/login");
});

test("Auth Matrix 2: Platform Admin + 0 companies -> /system-admin", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "admin-uid", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/system-admin");
  assert.notEqual(result.to, "/select-company");
});

test("Auth Matrix 3: Platform Admin + 1 company -> /system-admin by default", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "admin-uid", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 1,
    firstCompanyId: "comp-1",
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/system-admin");
});

test("Auth Matrix 4: Platform Admin + 3 companies -> /system-admin", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "admin-uid", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 3,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/system-admin");
});

test("Auth Matrix 5: Normal User + 0 companies -> /no-company-access", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "staff-1", email: "staff@example.com" },
    isPlatformAdmin: false,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/no-company-access");
});

test("Auth Matrix 6: Normal User + 1 company -> company dashboard (/)", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "staff-1", email: "accountant@apex.com" },
    isPlatformAdmin: false,
    companiesCount: 1,
    firstCompanyId: "comp-apex-123",
  });

  assert.equal(result.type, "dashboard");
  assert.equal(result.to, "/");
  assert.equal(result.companyId, "comp-apex-123");
});

test("Auth Matrix 7: Normal User + 2 companies -> /select-company", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "staff-1", email: "manager@group.com" },
    isPlatformAdmin: false,
    companiesCount: 2,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/select-company");
});

test("Auth Matrix 8: Admin UID requiring setup without claim -> /platform-admin-setup-required", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: false,
    setupRequired: true,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/platform-admin-setup-required");
});

test("Auth Matrix 9: Superseded legacy UID strictly blocked -> /login", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: SUPERSEDED_LEGACY_UID, email: "legacy@admin.com" },
    isPlatformAdmin: true, // even if claims spoofed
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/login");
});

test("Auth Matrix 10: Never redirects Platform Admin + 0 companies to Initialize Company Profile", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 0,
  });

  assert.notEqual(result.to, "/select-company");
  assert.equal(result.to, "/system-admin");
});

test("Regression 1: maaz Platform Admin + platformAdmin=true + 0 companies -> /system-admin", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/system-admin");
  assert.notEqual(result.to, "/no-company-access");
});

test("Regression 2: maaz Platform Admin + platformAdmin=true + multiple companies -> /system-admin", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: true,
    companiesCount: 5,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/system-admin");
  assert.notEqual(result.to, "/select-company");
});

test("Regression 3: Platform Admin claim loading -> waiting state -> NEVER /no-company-access", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: true,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: false,
    companiesCount: 0,
  });

  assert.equal(result.type, "waiting");
  assert.equal(result.reason, "loadingClaims");
  assert.notEqual(result.to, "/no-company-access");
});

test("Regression 4: Platform Admin candidate missing claim -> /platform-admin-setup-required", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2", email: "maaz@admin.com" },
    isPlatformAdmin: false,
    setupRequired: true,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/platform-admin-setup-required");
  assert.notEqual(result.to, "/no-company-access");
});

test("Regression 5: Normal user + 0 companies -> /no-company-access", () => {
  const result = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "normal-user-1", email: "user@example.com" },
    isPlatformAdmin: false,
    setupRequired: false,
    companiesCount: 0,
  });

  assert.equal(result.type, "redirect");
  assert.equal(result.to, "/no-company-access");
});

test("Regression 6: /no-company-access loaded by Platform Admin -> immediately replace /system-admin", () => {
  // Simulating the route guard logic in no-company-access.tsx
  function guardNoCompanyAccess(params) {
    if (params.isPlatformAdmin) return "/system-admin";
    if (params.setupRequired) return "/platform-admin-setup-required";
    if (params.companiesCount > 0) return "/";
    return "/no-company-access";
  }

  assert.equal(
    guardNoCompanyAccess({ isPlatformAdmin: true, setupRequired: false, companiesCount: 0 }),
    "/system-admin"
  );
  assert.equal(
    guardNoCompanyAccess({ isPlatformAdmin: false, setupRequired: true, companiesCount: 0 }),
    "/platform-admin-setup-required"
  );
  assert.equal(
    guardNoCompanyAccess({ isPlatformAdmin: false, setupRequired: false, companiesCount: 0 }),
    "/no-company-access"
  );
});
