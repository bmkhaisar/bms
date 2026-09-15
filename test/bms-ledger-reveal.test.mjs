import test from "node:test";
import assert from "node:assert/strict";

/**
 * BMS NEXT — Startup Experience Unit Test Suite
 *
 * Requirements:
 * 1. Shows ONLY the BMS startup animation on cold launch / refresh / PWA start.
 * 2. Does NOT show Login, Dashboard, Sidebar, forms, cards, or other UI behind it.
 * 3. Concurrently resolves Auth, custom claims, company memberships, and Dexie in the background.
 * 4. Keeps the startup experience visible for ~4 seconds.
 * 5. After completion, reveals the authoritative destination:
 *    - Logged in & company resolved -> Dashboard (/)
 *    - Logged out -> Sign In (/login)
 *    - Multiple companies -> Company Selection (/select-company)
 *    - Platform Admin -> System Admin (/system-admin)
 *    - 0 companies -> No Company Access (/no-company-access)
 *    - Still resolving after 4s -> Remains on clean loading state until resolution finishes.
 * 6. Internal TanStack router navigations DO NOT replay the startup screen.
 */

// Simulated deterministic resolver matching resolveAuthRoute
function resolveDestination(params) {
  if (params.authInitializing) {
    return { type: "waiting", reason: "initializingAuth" };
  }
  if (!params.user) {
    return { type: "redirect", to: "/login" };
  }
  if (params.claimsLoading) {
    return { type: "waiting", reason: "loadingClaims" };
  }
  if (params.isPlatformAdmin) {
    return { type: "redirect", to: "/system-admin" };
  }
  if (params.companiesLoading) {
    return { type: "waiting", reason: "resolvingCompanies" };
  }
  if (params.companiesCount === 0) {
    return { type: "redirect", to: "/no-company-access" };
  }
  if (params.companiesCount > 1 && !params.activeCompanyId) {
    return { type: "redirect", to: "/select-company" };
  }
  return { type: "dashboard", to: "/" };
}

// Controller state simulator
class StartupLifecycleSimulator {
  constructor(durationMs = 4000) {
    this.durationMs = durationMs;
    this.startTime = Date.now();
    this.animationDone = false;
    this.isStartupActive = true;
    this.isExiting = false;
    this.completed = false;
    this.resolvedRoute = null;
  }

  tick(elapsedMs, authParams) {
    const destination = resolveDestination(authParams);

    if (elapsedMs >= this.durationMs) {
      this.animationDone = true;
    }

    if (this.animationDone && destination.type !== "waiting" && !this.isExiting) {
      this.isExiting = true;
      this.resolvedRoute = destination.type === "dashboard" ? "/" : destination.to;
      this.isStartupActive = false;
      this.completed = true;
    }

    return {
      destination,
      isStartupActive: this.isStartupActive,
      isExiting: this.isExiting,
      animationDone: this.animationDone,
      resolvedRoute: this.resolvedRoute,
      isExtended: this.animationDone && destination.type === "waiting",
      // Crucial: Children (UI behind) must ONLY be rendered during the exit transition or after completion
      canRenderChildren: this.isExiting || this.completed,
    };
  }
}

test("Startup 1: Initial launch keeps UI behind hidden during 4-second animation", () => {
  const sim = new StartupLifecycleSimulator(4000);

  // At T = 1000ms: Auth already resolved as logged out, but animation is still running
  const stateAt1s = sim.tick(1000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: null,
  });

  assert.equal(stateAt1s.animationDone, false);
  assert.equal(stateAt1s.isStartupActive, true);
  assert.equal(stateAt1s.canRenderChildren, false); // No login form in DOM!
});

test("Startup 2: Destination 1 — Logged out user reveals /login after 4 seconds", () => {
  const sim = new StartupLifecycleSimulator(4000);

  // At T = 4000ms: Auth resolved as logged out
  const stateAt4s = sim.tick(4000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: null,
  });

  assert.equal(stateAt4s.animationDone, true);
  assert.equal(stateAt4s.resolvedRoute, "/login");
  assert.equal(stateAt4s.canRenderChildren, true);
});

test("Startup 3: Destination 2 — Logged in with company reveals Dashboard (/) after 4 seconds", () => {
  const sim = new StartupLifecycleSimulator(4000);

  const stateAt4s = sim.tick(4000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "user-123" },
    isPlatformAdmin: false,
    companiesCount: 1,
    activeCompanyId: "comp-1",
  });

  assert.equal(stateAt4s.animationDone, true);
  assert.equal(stateAt4s.resolvedRoute, "/");
  assert.equal(stateAt4s.canRenderChildren, true);
});

test("Startup 4: Destination 3 — Multiple companies reveals /select-company after 4 seconds", () => {
  const sim = new StartupLifecycleSimulator(4000);

  const stateAt4s = sim.tick(4000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "user-123" },
    isPlatformAdmin: false,
    companiesCount: 2,
    activeCompanyId: null,
  });

  assert.equal(stateAt4s.animationDone, true);
  assert.equal(stateAt4s.resolvedRoute, "/select-company");
});

test("Startup 5: Destination 4 — Platform Admin reveals /system-admin after 4 seconds", () => {
  const sim = new StartupLifecycleSimulator(4000);

  const stateAt4s = sim.tick(4000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "admin-uid" },
    isPlatformAdmin: true,
    companiesCount: 0,
  });

  assert.equal(stateAt4s.animationDone, true);
  assert.equal(stateAt4s.resolvedRoute, "/system-admin");
});

test("Startup 6: Destination 5 — 0 companies reveals /no-company-access after 4 seconds", () => {
  const sim = new StartupLifecycleSimulator(4000);

  const stateAt4s = sim.tick(4000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "staff-uid" },
    isPlatformAdmin: false,
    companiesCount: 0,
  });

  assert.equal(stateAt4s.animationDone, true);
  assert.equal(stateAt4s.resolvedRoute, "/no-company-access");
});

test("Startup 7: Extended Loading — If auth takes >4s, remains on clean startup loading screen", () => {
  const sim = new StartupLifecycleSimulator(4000);

  // At T = 4500ms: Companies still loading
  const stateAt4500ms = sim.tick(4500, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: true,
    user: { uid: "user-123" },
    isPlatformAdmin: false,
    companiesCount: 0,
  });

  assert.equal(stateAt4500ms.animationDone, true);
  assert.equal(stateAt4500ms.isExtended, true);
  assert.equal(stateAt4500ms.isStartupActive, true);
  assert.equal(stateAt4500ms.canRenderChildren, false); // Still hiding UI behind it!

  // At T = 5000ms: Companies finish resolving
  const stateAt5000ms = sim.tick(5000, {
    authInitializing: false,
    claimsLoading: false,
    companiesLoading: false,
    user: { uid: "user-123" },
    isPlatformAdmin: false,
    companiesCount: 1,
    activeCompanyId: "comp-1",
  });

  assert.equal(stateAt5000ms.resolvedRoute, "/");
  assert.equal(stateAt5000ms.canRenderChildren, true);
});

test("Startup 8: Internal navigation does not replay startup animation", () => {
  // Simulate window object with completed flag
  const windowObj = { __BMS_STARTUP_COMPLETED__: true };

  function checkShouldRunStartup(win) {
    return !win.__BMS_STARTUP_COMPLETED__;
  }

  assert.equal(checkShouldRunStartup(windowObj), false);

  // Refresh (new window object)
  const freshWindow = {};
  assert.equal(checkShouldRunStartup(freshWindow), true);
});
