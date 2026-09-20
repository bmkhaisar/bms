import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p) => readFileSync(resolve(process.cwd(), p), "utf8");

test("1. Viewport meta tag disables mobile page zoom while supporting notch/safe-areas", () => {
  const rootSrc = read("src/routes/__root.tsx");
  assert.ok(rootSrc.includes("viewport-fit=cover"), "Must include viewport-fit=cover");
  assert.ok(rootSrc.includes("maximum-scale=1"), "Must include maximum-scale=1");
  assert.ok(rootSrc.includes("user-scalable=no"), "Must include user-scalable=no");
  assert.ok(rootSrc.includes("width=device-width"), "Must include width=device-width");
});

test("2. CSS handles responsive touch, overflow-x, and preserves PDF preview zoom", () => {
  const stylesSrc = read("src/styles.css");
  assert.ok(stylesSrc.includes("touch-action: manipulation"), "Standard UI must have touch-action: manipulation to prevent double-tap zoom delay");
  assert.ok(stylesSrc.includes("overflow-x: hidden"), "HTML/Body must enforce overflow-x: hidden");

  // PDF Preview exception
  assert.ok(
    stylesSrc.includes("#canonical-pdf-preview") || stylesSrc.includes(".pdf-preview-container"),
    "Must preserve PDF preview zoom container"
  );
  assert.ok(stylesSrc.includes("touch-action: auto !important"), "PDF preview must allow standard touch zoom");
});

test("3. Dialogs and Tabs are adapted for mobile screens without clipping or overflow", () => {
  const dialogSrc = read("src/components/ui/dialog.tsx");
  assert.ok(
    dialogSrc.includes("w-[calc(100vw-2rem)]") || dialogSrc.includes("max-w-[calc(100vw-2rem)]"),
    "Dialog must fit within viewport with margins"
  );
  assert.ok(dialogSrc.includes("max-h-[92vh]"), "Dialog must enforce max-height to avoid off-screen overflow");
  assert.ok(dialogSrc.includes("overflow-y-auto"), "Dialog must allow vertical scrolling");

  const tabsSrc = read("src/components/ui/tabs.tsx");
  assert.ok(tabsSrc.includes("h-auto") || tabsSrc.includes("min-h-10"), "TabsList must allow multi-line height");
  assert.ok(tabsSrc.includes("flex-wrap") || tabsSrc.includes("overflow-x-auto"), "TabsList must wrap or scroll on narrow devices");
});

test("4. AppShell & Topbar provide fast navigation without remount blank flashes", () => {
  const shellSrc = read("src/components/app/AppShell.tsx");
  assert.ok(shellSrc.includes("overflow-x-hidden"), "AppShell main column must prevent horizontal spillage");
  // Ensure we don't key motion.main by title or pathname which causes blank screen flashes
  assert.ok(!shellSrc.includes("key={title}"), "AppShell must not unmount on navigation");

  const topbarSrc = read("src/components/app/Topbar.tsx");
  assert.ok(topbarSrc.includes("useRouterState"), "Topbar must check router pending state for immediate feedback");
  assert.ok(topbarSrc.includes("isNavigating"), "Topbar must show pending navigation bar");
});

test("5. useAccounting synchronizes all 3 Firebase listeners before setting loading=false", () => {
  const accountingHookSrc = read("src/modules/accounting/useAccounting.ts");
  assert.ok(accountingHookSrc.includes("vouchersLoaded"), "Must track vouchers listener status");
  assert.ok(accountingHookSrc.includes("ledgersLoaded"), "Must track ledgers listener status");
  assert.ok(accountingHookSrc.includes("groupsLoaded"), "Must track groups listener status");
  assert.ok(accountingHookSrc.includes("checkAllLoaded"), "Must gate loading state on all three streams");
});

test("6. CAReviewWorkspace and TrialBalanceView implement comprehensive skeleton loading", () => {
  const caReviewSrc = read("src/modules/accounting/components/CAReviewWorkspace.tsx");
  assert.ok(caReviewSrc.includes("CAReviewSkeleton"), "CAReviewWorkspace must have CAReviewSkeleton");
  assert.ok(caReviewSrc.includes("loading?: boolean"), "CAReviewWorkspace must accept loading prop");

  const trialBalanceSrc = read("src/modules/accounting/components/TrialBalanceView.tsx");
  assert.ok(trialBalanceSrc.includes("TrialBalanceSkeleton"), "TrialBalanceView must have TrialBalanceSkeleton");
  assert.ok(trialBalanceSrc.includes("loading?: boolean"), "TrialBalanceView must accept loading prop");

  const caRouteSrc = read("src/routes/_app.ca-review.tsx");
  assert.ok(caRouteSrc.includes("isDexieLoaded"), "CA Review route must track Dexie load status");
  assert.ok(caRouteSrc.includes("isLoading = accountingLoading || !isDexieLoaded"), "CA Review must compute isLoading from accounting and Dexie");
  assert.ok(caRouteSrc.includes("loading={isLoading}"), "CA Review must pass loading prop");
});

test("7. Reports Stat cards, Quotations and DocumentListPage eliminate fake ₹0 flashes", () => {
  const reportsSrc = read("src/routes/_app.reports.tsx");
  assert.ok(reportsSrc.includes("loading || !v"), "Stat component must render skeleton placeholder during loading");
  assert.ok(reportsSrc.includes("animate-pulse"), "Stat must use pulse animation when loading");

  const quotationsSrc = read("src/components/app/QuotationsPage.tsx");
  assert.ok(quotationsSrc.includes("useLiveState"), "QuotationsPage must use useLiveState");
  assert.ok(quotationsSrc.includes("initialLoading = !rawRowsState.isLoaded"), "QuotationsPage must derive loading from authoritative Dexie state");

  const docListSrc = read("src/components/app/DocumentListPage.tsx");
  assert.ok(docListSrc.includes("rowsState.isLoaded"), "DocumentListPage must check authoritative rowsState.isLoaded");
});
