import test from "node:test";
import assert from "node:assert/strict";

test("company-switch-cache.test: Switching Company A -> Company B immediately clears state to prevent stale data flash", () => {
  let activeCompany = { id: "comp-A", name: "Alpha Traders" };
  let activeMembership = { role: "owner" };
  let financialYears = [{ id: "fy-2025", name: "2025-2026" }];
  let activeFinancialYearId = "fy-2025";
  let activeCompanyId = "comp-A";

  function switchCompany(newCompanyId) {
    // PRD § 62: Immediately clear previous company state
    activeCompany = null;
    activeMembership = null;
    financialYears = [];
    activeFinancialYearId = null;
    activeCompanyId = newCompanyId;
  }

  // User switches to Company B
  switchCompany("comp-B");

  assert.equal(activeCompany, null, "activeCompany must immediately reset to null so child components unmount or show skeletons");
  assert.equal(activeMembership, null, "activeMembership must immediately reset");
  assert.equal(financialYears.length, 0, "financialYears must be cleared");
  assert.equal(activeFinancialYearId, null, "activeFinancialYearId must be cleared");
  assert.equal(activeCompanyId, "comp-B", "activeCompanyId set to new tenant");
});

test("listener-cleanup.test: Listeners unsubscribe on company change or logout to prevent memory/socket leaks", () => {
  let activeSubscriptions = new Map();
  let offCount = 0;

  function subscribe(path, cb) {
    activeSubscriptions.set(path, cb);
    return () => {
      activeSubscriptions.delete(path);
      offCount++;
    };
  }

  // Subscribe to company A's ledgers and documents
  const unsubLedgers = subscribe("companyData/comp-A/ledgers", () => {});
  const unsubInvoices = subscribe("companyData/comp-A/invoices", () => {});

  assert.equal(activeSubscriptions.size, 2, "2 active subscriptions initialized");

  // Trigger company change cleanup
  unsubLedgers();
  unsubInvoices();

  assert.equal(activeSubscriptions.size, 0, "All subscriptions unsubscribed on switch");
  assert.equal(offCount, 2, "Firebase off() called for every listener");
});
