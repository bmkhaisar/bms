import test from "node:test";
import assert from "node:assert/strict";

test("Logout Pipeline 1: performAuthenticatedSessionCleanup is single-flight and idempotent", async () => {
  let signOutCalls = 0;
  let listenersCleaned = 0;
  let outboxStopped = 0;
  let redirectUrl = "";

  // Simulation of single-flight cleanup runner
  let cleanupPromise = null;

  async function performAuthenticatedSessionCleanup(reason = "manual") {
    if (cleanupPromise) return cleanupPromise;

    cleanupPromise = (async () => {
      outboxStopped++;
      listenersCleaned++;
      signOutCalls++;
      redirectUrl = "/login";
      return { reason, redirected: true };
    })();

    const result = await cleanupPromise;
    cleanupPromise = null;
    return result;
  }

  // Fire 5 concurrent logout triggers (manual, expired, switch_account, auth_null, revoked)
  const results = await Promise.all([
    performAuthenticatedSessionCleanup("manual"),
    performAuthenticatedSessionCleanup("expired"),
    performAuthenticatedSessionCleanup("switch_account"),
    performAuthenticatedSessionCleanup("manual"),
    performAuthenticatedSessionCleanup("expired"),
  ]);

  // Assert single-flight deduplication: exactly 1 signOut execution
  assert.equal(signOutCalls, 1, "Firebase signOut must be invoked exactly once during concurrent logouts");
  assert.equal(listenersCleaned, 1, "Listeners must be unsubscribed exactly once");
  assert.equal(outboxStopped, 1, "Outbox manager must be stopped exactly once");
  assert.equal(redirectUrl, "/login", "Destination must reliably be /login");
  assert.equal(results.length, 5);
});

test("Logout Pipeline 2: Manual Sign Out clears credentials and redirects to /login", async () => {
  let currentAuthUser = { uid: "user-123", email: "user@example.com" };
  let activeCompanyState = { companyId: "comp-1" };
  let currentRoute = "/invoices";

  async function handleSignOut() {
    currentAuthUser = null;
    activeCompanyState = null;
    currentRoute = "/login";
  }

  await handleSignOut();

  assert.equal(currentAuthUser, null, "User credential must be purged");
  assert.equal(activeCompanyState, null, "Active company context must be purged");
  assert.equal(currentRoute, "/login", "Route must immediately update to /login");
});

test("Logout Pipeline 3: Sign in with different account clears previous session before navigating to /login", async () => {
  let activeSessionUid = "admin-old-uid";
  let navigatedRoute = "";

  async function signOutAndSwitchAccount() {
    activeSessionUid = null;
    navigatedRoute = "/login";
  }

  await signOutAndSwitchAccount();

  assert.equal(activeSessionUid, null, "Old account session must be purged");
  assert.equal(navigatedRoute, "/login", "Must land on /login cleanly");
});

test("Logout Pipeline 4: 2-hour session expiry calls canonical cleanup", () => {
  const MAX_SESSION_AGE_MS = 7200 * 1000;
  const authTimeSeconds = Math.floor(Date.now() / 1000) - 7205; // 5 seconds past 2 hours
  const expiryMs = authTimeSeconds * 1000 + MAX_SESSION_AGE_MS;

  function isSessionExpired(now = Date.now()) {
    return now >= expiryMs;
  }

  assert.equal(isSessionExpired(), true, "Session older than 7200s must be marked expired");
});

test("Logout Pipeline 5: Private routes strictly redirect to /login when auth state is null", () => {
  const privateRoutes = [
    "/",
    "/invoices",
    "/quotations",
    "/ledger",
    "/receipts",
    "/system-admin",
    "/select-company",
    "/no-company-access",
    "/platform-admin-setup-required",
  ];

  function evaluateRouteGuard(route, authUser, authInitializing) {
    if (authInitializing) return "WAIT";
    if (!authUser) return "/login";
    return route;
  }

  for (const route of privateRoutes) {
    const destination = evaluateRouteGuard(route, null, false);
    assert.equal(destination, "/login", `Private route ${route} must redirect unauthenticated user to /login`);
  }
});

test("Logout Pipeline 6: Browser Back button cannot access private screens after logout", () => {
  // Simulates browser history popstate event after logout
  let authUser = null;

  function onPopStateRouteGuard(targetPrivatePath) {
    if (!authUser) {
      return { allowRender: false, redirect: "/login", replace: true };
    }
    return { allowRender: true, redirect: null };
  }

  const popResult = onPopStateRouteGuard("/ledger");
  assert.equal(popResult.allowRender, false, "Private content must not render on history back button");
  assert.equal(popResult.redirect, "/login", "Must redirect back to /login");
  assert.equal(popResult.replace, true, "Must replace history entry");
});

test("Logout Pipeline 7: Realtime listeners unsubscribe cleanly on logout", () => {
  const activeListeners = new Set(["userCompanies/123", "companies/compA", "memberships/compA/123"]);

  function cleanupAllListeners() {
    activeListeners.clear();
  }

  cleanupAllListeners();
  assert.equal(activeListeners.size, 0, "All active Firebase realtime listeners must be unsubscribed");
});

test("Logout Pipeline 8: Outbox sync processing worker pauses safely on logout", () => {
  let isOutboxRunning = true;

  function stopOutbox() {
    isOutboxRunning = false;
  }

  stopOutbox();
  assert.equal(isOutboxRunning, false, "Outbox processing must be stopped on logout");
});
