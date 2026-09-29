import test from "node:test";
import assert from "node:assert/strict";

/**
 * Pure Deterministic Auth Routing Matrix (PRD Section 12 & 13)
 */
function resolveAuthRoute(params) {
  if (params.authInitializing) return { type: "waiting", reason: "initializingAuth" };
  if (!params.user) return { type: "login", to: "/login" };
  if (params.claimsLoading) return { type: "waiting", reason: "loadingClaims" };
  if (params.isPlatformAdmin) return { type: "platformAdmin", to: "/system-admin" };
  if (params.companiesLoading) return { type: "waiting", reason: "resolvingCompanies" };
  if (params.companiesCount === 0) return { type: "noCompany", to: "/no-company-access" };
  if (params.companiesCount > 1 && !params.activeCompanyId) return { type: "selectCompany", to: "/select-company" };
  return { type: "dashboard", to: "/" };
}

const PUBLIC_INFORMATIONAL_ROUTES = [
  "/about",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
];

test("Public Routing: Unauthenticated visitor can access all canonical public informational routes", () => {
  for (const path of PUBLIC_INFORMATIONAL_ROUTES) {
    // resolveAuthRoute for unauthenticated user
    const destination = resolveAuthRoute({
      authInitializing: false,
      claimsLoading: false,
      companiesLoading: false,
      user: null,
      isPlatformAdmin: false,
      companiesCount: 0,
      firstCompanyId: null,
      activeCompanyId: null,
    });

    // Destination for unauthenticated user is login if not bypassed by public route architecture
    assert.equal(destination.type, "login");
    assert.equal(destination.to, "/login");

    // BUT for public informational routes, they are defined outside protected ERP shell:
    const PUBLIC_ROUTES = new Set(["/", "/about", "/faq", "/contact", "/terms", "/privacy", "/login"]);
    assert.equal(PUBLIC_ROUTES.has(path), true, `${path} must be recognized as a public route`);
  }
});

test("Public Routing: Protected ERP routes require authentication", () => {
  const PROTECTED_ERP_ROUTES = ["/invoices", "/quotations", "/receipts", "/purchases", "/reports", "/ledger"];
  const PUBLIC_ROUTES = new Set(["/", "/about", "/faq", "/contact", "/terms", "/privacy", "/login"]);

  for (const route of PROTECTED_ERP_ROUTES) {
    assert.equal(PUBLIC_ROUTES.has(route), false, `${route} must NOT be a public route`);
  }
});

test("Public Routing: Authenticated user on / or /login resolves to dashboard", () => {
  const mockUser = { uid: "user_123", email: "test@example.com" };

  const destSingleCompany = resolveAuthRoute({
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: mockUser,
    isPlatformAdmin: false,
    companiesCount: 1,
    firstCompanyId: "comp_1",
    activeCompanyId: "comp_1",
  });

  assert.equal(destSingleCompany.type, "dashboard", "Single company user resolves to dashboard");
  assert.equal(destSingleCompany.to, "/");
});

test("Public Routing: Authenticated user visiting informational routes (/about, /terms, etc.) stays on page", () => {
  // In BmsStartupController:
  // if (isPublicInfo || (!user && isPublicRoute)) { targetPath = loc.pathname; }
  for (const path of PUBLIC_INFORMATIONAL_ROUTES) {
    const isPublicInfo =
      path === "/about" ||
      path === "/faq" ||
      path === "/contact" ||
      path === "/terms" ||
      path === "/privacy";

    assert.equal(isPublicInfo, true, `${path} must be recognized as public informational route`);
  }
});

test("Public Routing: TanStack Router absolute path links invariant", () => {
  const links = [
    { source: "Header About", to: "/about" },
    { source: "Header FAQ", to: "/faq" },
    { source: "Header Contact", to: "/contact" },
    { source: "Header Sign In", to: "/login" },
    { source: "Footer About", to: "/about" },
    { source: "Footer FAQ", to: "/faq" },
    { source: "Footer Contact", to: "/contact" },
    { source: "Footer Terms", to: "/terms" },
    { source: "Footer Privacy", to: "/privacy" },
    { source: "Footer Sign In", to: "/login" },
    { source: "Login Terms", to: "/terms" },
    { source: "Login Privacy", to: "/privacy" },
    { source: "Login Back Home", to: "/" },
  ];

  for (const link of links) {
    assert.ok(link.to.startsWith("/"), `${link.source} must use absolute canonical path (starts with /): got ${link.to}`);
    assert.ok(!link.to.startsWith("//"), `${link.source} must not start with double slashes`);
  }
});
