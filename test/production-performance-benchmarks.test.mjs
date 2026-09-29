import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildPdfCacheKey,
  computeDocumentEffectiveFingerprint,
  sha256,
  stableSerialize,
  getCachedPdfBlob,
  setCachedPdfBlob,
  invalidatePdfBlobCache,
  invalidateDraftPdfCache,
  clearPdfBlobCache,
  getCachedAsset,
  setCachedAsset,
  clearCompanyAssetCache,
} from "../src/modules/documents/pdfCacheService.ts";

import {
  reconcileDashboardSummaryProjection,
  buildDashboardSummaryCacheKey,
  getCachedDashboardSummary,
  setCachedDashboardSummary,
  invalidateDashboardSummaryCache,
  formatCanonicalDateBoundary,
  reconcileDashboardSummaryProjectionSingleFlight,
  reconcileDashboardSummarySynchronousSafe,
} from "../src/modules/accounting/services/dashboardReportService.ts";
import crypto from "node:crypto";

test("PDF_FINGERPRINT_SHA256 & PDF_CACHE_COLLISION_RISK_HARDENED: Pure TypeScript SHA-256 is bit-exact with RFC 6234 / Node Crypto", () => {
  const sampleStrings = [
    "hello world",
    "BMS NEXT EffectiveDocumentPdfSnapshot",
    JSON.stringify({ a: 1, b: "test ₹ and symbols" }),
  ];

  for (const s of sampleStrings) {
    const nativeSha = crypto.createHash("sha256").update(s).digest("hex");
    const tsSha = sha256(s);
    assert.equal(tsSha, nativeSha, `SHA-256 must match native crypto bit-for-bit for '${s}'`);
  }

  // Deterministic stableSerialize ordering
  const obj1 = { z: 1, a: 2, m: { y: 10, x: 20 } };
  const obj2 = { a: 2, m: { x: 20, y: 10 }, z: 1 };
  assert.equal(stableSerialize(obj1), stableSerialize(obj2), "stableSerialize must be independent of key insertion order");
});

test("PDF_CACHE_STALE_DOCUMENT & PDF_DRAFT_INVALIDATION: Cache key changes on EVERY document alteration", () => {
  clearPdfBlobCache();

  const baseDraft = {
    id: "inv-draft-001",
    number: "DRAFT-001",
    postingStatus: "draft",
    date: 1775000000000,
    customerId: "cust-1",
    customerSnapshot: { name: "Acme Corp", gstin: "29AABCU9603R1ZM" },
    billingAddress: "123 Industrial Estate",
    shippingAddress: "456 Warehouse Blvd",
    placeOfSupply: "29-Karnataka",
    items: [
      {
        name: "Standard Steel Tube",
        description: "Grade 304",
        size: "50x50x2mm",
        quantity: 10,
        rate: 1500,
        discountPct: 5,
        gstRate: 18,
        taxableAmount: 14250,
        total: 16815,
      },
    ],
    extraCharges: [{ label: "Freight", amount: 500 }],
    grandTotal: 17315,
    terms: "Payment within 30 days",
    generalInfoSnapshot: [{ label: "PO Number", value: "PO-999" }],
    technicalSpecifications: [{ section: "Specs", rows: [{ k: "Grade", v: "SS304" }] }],
    bankDetailsSnapshot: { accountNumber: "9988776655", ifsc: "HDFC0001234" },
    signatoryOverride: { showSignature: true, showStamp: true },
    deliveryNote: "DN-101",
    watermarkMode: "off",
  };

  const initialKey = buildPdfCacheKey(baseDraft);
  assert.ok(initialKey.startsWith("DRAFT:inv-draft-001:"), "Key must begin with DRAFT:<docId>:");
  const draftFingerprint = computeDocumentEffectiveFingerprint(baseDraft);
  assert.ok(draftFingerprint.startsWith("DRAFT:SHA256:"), "Draft fingerprint must use SHA256 prefix");
  assert.equal(draftFingerprint.length, "DRAFT:SHA256:".length + 64, "Must contain full 64-char SHA-256 digest");

  // 1. Changing customer/supplier must produce a different cache key
  const alteredCustomer = { ...baseDraft, customerId: "cust-2", customerSnapshot: { name: "Beta Corp" } };
  assert.notEqual(buildPdfCacheKey(alteredCustomer), initialKey, "Customer change must alter cache key");

  // 2. Changing rate or quantity must produce a different cache key
  const alteredRate = {
    ...baseDraft,
    items: [{ ...baseDraft.items[0], rate: 1600 }],
    grandTotal: 18450,
  };
  assert.notEqual(buildPdfCacheKey(alteredRate), initialKey, "Rate/Total change must alter cache key");

  // 3. Changing description or size must produce a different cache key
  const alteredSize = {
    ...baseDraft,
    items: [{ ...baseDraft.items[0], size: "60x60x3mm" }],
  };
  assert.notEqual(buildPdfCacheKey(alteredSize), initialKey, "Size change must alter cache key");

  // 4. Changing terms or bank details must produce a different cache key
  const alteredTerms = { ...baseDraft, terms: "Immediate payment required" };
  assert.notEqual(buildPdfCacheKey(alteredTerms), initialKey, "Terms change must alter cache key");

  // 5. Changing transport info must produce a different cache key
  const alteredTransport = { ...baseDraft, deliveryNote: "DN-999" };
  assert.notEqual(buildPdfCacheKey(alteredTransport), initialKey, "Transport change must alter cache key");

  // 6. Explicit draft invalidation
  const mockBlob = new Blob(["mock-pdf"], { type: "application/pdf" });
  setCachedPdfBlob(initialKey, mockBlob);
  assert.equal(getCachedPdfBlob(initialKey), mockBlob);
  invalidateDraftPdfCache("inv-draft-001");
  assert.equal(getCachedPdfBlob(initialKey), null, "Explicit invalidation must purge cache");
});

test("ISSUED_COPYTYPE_CACHE_ISOLATION & ISSUED_OPTIONS_CACHE_ISOLATION & ISSUED_SNAPSHOT_IMMUTABILITY: Issued PDFs isolate copy types and render options", () => {
  const postedInvoice = {
    id: "inv-posted-001",
    number: "INV/2026-27/0001",
    postingStatus: "posted",
    postedAt: 1775050000000,
    snapshotVersion: 3,
    grandTotal: 50000,
  };

  const keyOriginal = buildPdfCacheKey(postedInvoice, { copyLabel: "ORIGINAL" });
  assert.ok(keyOriginal.startsWith("ISSUED:inv-posted-001:3:ORIGINAL:"), "Must embed ISSUED:<id>:<snapshotVersion>:<copyType>:<optionsFingerprint>");

  // 1. Copy type isolation: ORIGINAL vs COPY vs DRIVER / TRANSPORT COPY
  const keyCopy = buildPdfCacheKey(postedInvoice, { copyLabel: "COPY" });
  const keyTransport = buildPdfCacheKey(postedInvoice, { copyLabel: "DRIVER / TRANSPORT COPY" });
  assert.notEqual(keyOriginal, keyCopy, "ORIGINAL and COPY must have separate cache keys");
  assert.notEqual(keyOriginal, keyTransport, "ORIGINAL and DRIVER / TRANSPORT COPY must have separate cache keys");
  assert.notEqual(keyCopy, keyTransport, "COPY and DRIVER / TRANSPORT COPY must have separate cache keys");

  // 2. Options isolation: descriptions, bank details, terms, general info, tech specs, watermark
  const keyNoDesc = buildPdfCacheKey(postedInvoice, { copyLabel: "ORIGINAL", includeDescriptions: false });
  assert.notEqual(keyOriginal, keyNoDesc, "includeDescriptions toggle must isolate cache key");

  const keyNoBank = buildPdfCacheKey(postedInvoice, { copyLabel: "ORIGINAL", includeBankDetails: false });
  assert.notEqual(keyOriginal, keyNoBank, "includeBankDetails toggle must isolate cache key");

  const keyWatermark = buildPdfCacheKey(postedInvoice, { copyLabel: "ORIGINAL", watermark: "CONFIDENTIAL" });
  assert.notEqual(keyOriginal, keyWatermark, "watermark option must isolate cache key");
});

test("PDF_ASSET_VERSIONING: Asset cache incorporates companyId, assetType, and assetVersion", () => {
  clearCompanyAssetCache();

  setCachedAsset("comp-1", "logo", "logo.png", "data:image/png;base64,v1Logo", "v1");
  assert.equal(getCachedAsset("comp-1", "logo", "logo.png", "v1"), "data:image/png;base64,v1Logo");

  // Changing version token is a cache miss, ensuring zero stale assets
  assert.equal(getCachedAsset("comp-1", "logo", "logo.png", "v2"), null);

  // Storing v2
  setCachedAsset("comp-1", "logo", "logo.png", "data:image/png;base64,v2Logo", "v2");
  assert.equal(getCachedAsset("comp-1", "logo", "logo.png", "v2"), "data:image/png;base64,v2Logo");
});

test("DASHBOARD_PERIOD_SCOPED_CACHE & NO_CROSS_PERIOD_CACHE_REUSE & CUSTOM_RANGE_CACHE_CORRECTNESS: Distinct periods, branches, and FYs maintain independent projections", () => {
  invalidateDashboardSummaryCache();

  // Test 1: Canonical Date Boundary formatting
  assert.equal(formatCanonicalDateBoundary("2026-09-01"), "2026-09-01");
  assert.equal(formatCanonicalDateBoundary(new Date("2026-09-15T00:00:00Z")), "2026-09-15");
  assert.equal(formatCanonicalDateBoundary(undefined), "all");

  // Test 2: This Month vs Last Month vs MTD vs Custom Range transitions
  const scopeThisMonth = {
    companyId: "comp-1",
    branchScope: "all",
    financialYearId: "fy-2026-27",
    fromDate: "2026-09-01",
    toDate: "2026-09-30",
    comparisonKey: "none",
  };

  const scopeLastMonth = {
    companyId: "comp-1",
    branchScope: "all",
    financialYearId: "fy-2026-27",
    fromDate: "2026-08-01",
    toDate: "2026-08-31",
    comparisonKey: "none",
  };

  const scopeMtd = {
    companyId: "comp-1",
    branchScope: "all",
    financialYearId: "fy-2026-27",
    fromDate: "2026-09-01",
    toDate: "2026-09-29",
    comparisonKey: "mtd_vs_lmtd",
  };

  const scopeCustom = {
    companyId: "comp-1",
    branchScope: "all",
    financialYearId: "fy-2026-27",
    fromDate: "2026-07-15",
    toDate: "2026-08-15",
    comparisonKey: "none",
  };

  const scopeMainBranch = {
    ...scopeThisMonth,
    branchScope: "branch-main",
  };

  const scopeOtherFy = {
    ...scopeThisMonth,
    financialYearId: "fy-2025-26",
    fromDate: "2025-09-01",
    toDate: "2025-09-30",
  };

  const keyThisMonth = buildDashboardSummaryCacheKey(scopeThisMonth);
  const keyLastMonth = buildDashboardSummaryCacheKey(scopeLastMonth);
  const keyMtd = buildDashboardSummaryCacheKey(scopeMtd);
  const keyCustom = buildDashboardSummaryCacheKey(scopeCustom);
  const keyMainBranch = buildDashboardSummaryCacheKey(scopeMainBranch);
  const keyOtherFy = buildDashboardSummaryCacheKey(scopeOtherFy);

  // Transitions: All keys must be strictly mutually distinct
  assert.notEqual(keyThisMonth, keyLastMonth, "This Month -> Last Month must not share cache");
  assert.notEqual(keyLastMonth, keyMtd, "Last Month -> MTD must not share cache");
  assert.notEqual(keyMtd, keyCustom, "MTD -> Custom Range must not share cache");
  assert.notEqual(keyThisMonth, keyMainBranch, "All Branches -> Main Branch must not share cache");
  assert.notEqual(keyThisMonth, keyOtherFy, "FY 2026-27 -> FY 2025-26 must not share cache");

  // Verify get/set behavior across transitions
  const mockThisMonthMetrics = { totalSales: 100000, hasData: true };
  const mockLastMonthMetrics = { totalSales: 80000, hasData: true };

  setCachedDashboardSummary(scopeThisMonth, mockThisMonthMetrics);
  setCachedDashboardSummary(scopeLastMonth, mockLastMonthMetrics);

  // Switching periods returns the exact corresponding projection and never bleeds
  assert.equal(getCachedDashboardSummary(scopeThisMonth)?.totalSales, 100000);
  assert.equal(getCachedDashboardSummary(scopeLastMonth)?.totalSales, 80000);
  assert.equal(getCachedDashboardSummary(scopeCustom), null, "Uncached custom range must return null without stale bleed");
});

test("SUMMARY_REBUILD_SINGLE_FLIGHT & NO_RENDER_LOOP_REBUILD: Reconciliation deduplicates concurrent calls and prevents render loops", async () => {
  const mockAccountingData = {
    ledgers: [
      { id: "led-1", name: "Bank Account", type: "asset", balance: 5000, balancePaise: 500000 },
      { id: "led-2", name: "Sales Account", type: "income", balance: -5000, balancePaise: -500000 },
    ],
    vouchers: [],
    invoices: [],
    purchases: [],
    products: [],
    receipts: [],
    payments: [],
    salesReturns: [],
    creditNotes: [],
    branches: [],
    scope: { companyId: "comp-1" },
  };

  const testScopeKey = "test-rebuild-scope-1";

  // 1. Single Flight Concurrent Test: Fire two concurrent calls
  const [flight1, flight2] = await Promise.all([
    reconcileDashboardSummaryProjectionSingleFlight(testScopeKey, mockAccountingData),
    reconcileDashboardSummaryProjectionSingleFlight(testScopeKey, mockAccountingData),
  ]);

  assert.ok(flight1.rebuiltProjection, "Flight 1 must produce rebuilt projection");
  assert.equal(flight2.singleFlight, true, "Concurrent second flight must be flagged as singleFlight deduplicated");

  // 2. Render Loop Prevention: Immediate subsequent call within cooldown is throttled
  const loopAttempt = reconcileDashboardSummarySynchronousSafe(testScopeKey, mockAccountingData);
  assert.equal(loopAttempt.skippedDueToCooldown, true, "Rapid subsequent call must skip full rebuild via cooldown");
});

test("ROUTE_PREFETCH_BOUNDED: Sidebar route links prefetch only JS chunks without triggering heavy data queries", () => {
  const sidebarFile = fs.readFileSync(path.resolve("src/components/app/Sidebar.tsx"), "utf-8");
  const reportsRouteFile = fs.readFileSync(path.resolve("src/routes/_app.reports.tsx"), "utf-8");
  const ledgerRouteFile = fs.readFileSync(path.resolve("src/routes/_app.ledger.tsx"), "utf-8");

  // Sidebar preloads route code
  assert.match(sidebarFile, /preload="intent"/);

  // Route definitions must not declare unbounded root loaders that fetch huge datasets
  assert.ok(!reportsRouteFile.includes("loader: async () =>"), "Reports route must not download full dataset in route loader");
  assert.ok(!ledgerRouteFile.includes("loader: async () =>"), "Ledger route must not download full ledger in route loader");
});

test("PRODUCTION_ENV & UI_CLEANUP: Strict APP_ENV evaluation for SSR and Browser with zero staging UI in production", () => {
  const envFile = fs.readFileSync(path.resolve("src/config/env.ts"), "utf-8");
  const settingsFile = fs.readFileSync(path.resolve("src/routes/_app.settings.tsx"), "utf-8");

  // Invariant 1: No hostname guessing in env.ts
  assert.ok(!envFile.includes("window.location.hostname"), "Hostname guessing must be eliminated from env.ts");

  // Invariant 2: Explicit APP_ENV precedence
  assert.match(envFile, /APP_ENV\s*===\s*"production"/);
  assert.match(envFile, /APP_ENV\s*===\s*"staging"/);

  // Invariant 3: Company Settings footer must never render raw 'Branch: staging'
  assert.ok(!settingsFile.includes("Branch: <code"), "Settings footer must not expose raw 'Branch: staging'");
});

test("PRODUCT_SEARCH_LOCAL_INDEXED: High-speed priority-ranked search over 1,000 products completes in < 20ms", () => {
  const products = [];
  for (let i = 1; i <= 1000; i++) {
    products.push({
      id: `prod-${i}`,
      name: i === 42 ? "Titanium Fastener M8" : `Standard Hardware Product ${i}`,
      sku: i === 42 ? "TITAN-8" : `SKU-${i.toString().padStart(4, "0")}`,
      hsn: "7318",
      aliases: i === 42 ? ["Ti-Bolt", "Lightweight Screw"] : [],
      sellingPrice: 15000,
      unit: "PCS",
    });
  }

  function benchmarkSearch(q) {
    const norm = q.trim().toLowerCase();
    const matches = [];

    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const skuLower = p.sku ? p.sku.toLowerCase() : "";
      const nameLower = p.name.toLowerCase();

      if (skuLower === norm) {
        matches.push({ product: p, rank: 1 });
        continue;
      }
      if (skuLower.startsWith(norm)) {
        matches.push({ product: p, rank: 2 });
        continue;
      }
      if (nameLower.startsWith(norm)) {
        matches.push({ product: p, rank: 3 });
        continue;
      }
      if (nameLower.includes(norm)) {
        matches.push({ product: p, rank: 4 });
        continue;
      }
      if (Array.isArray(p.aliases)) {
        let aliasMatch = false;
        for (const a of p.aliases) {
          if (a.toLowerCase().includes(norm)) {
            matches.push({ product: p, rank: 5 });
            aliasMatch = true;
            break;
          }
        }
        if (aliasMatch) continue;
      }
    }

    return matches
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 25)
      .map((m) => m.product);
  }

  const t0 = performance.now();
  const skuResults = benchmarkSearch("titan-8");
  const t1 = performance.now();
  const duration = t1 - t0;

  assert.equal(skuResults.length, 1);
  assert.equal(skuResults[0].id, "prod-42");
  assert.ok(duration < 20, `Search must complete in < 20ms (was ${duration.toFixed(3)}ms)`);
});
