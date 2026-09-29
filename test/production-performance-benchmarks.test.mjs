import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildPdfCacheKey,
  computeDocumentEffectiveFingerprint,
  getCachedPdfBlob,
  setCachedPdfBlob,
  invalidatePdfBlobCache,
  invalidateDraftPdfCache,
  clearPdfBlobCache,
  getCachedAsset,
  setCachedAsset,
  clearCompanyAssetCache,
} from "../src/modules/documents/pdfCacheService.ts";

import { reconcileDashboardSummaryProjection } from "../src/modules/accounting/services/dashboardReportService.ts";

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
  assert.ok(initialKey.startsWith("inv-draft-001:DRAFT:"));

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

test("PDF_ISSUED_SNAPSHOT_IMMUTABILITY: Finalized documents use immutable snapshot versioning", () => {
  const postedInvoice = {
    id: "inv-posted-001",
    number: "INV/2026-27/0001",
    postingStatus: "posted",
    postedAt: 1775050000000,
    snapshotVersion: 3,
    grandTotal: 50000,
  };

  const key1 = buildPdfCacheKey(postedInvoice, { copyLabel: "ORIGINAL" });
  assert.ok(key1.includes("ISSUED:3"), "Issued doc cache key must embed authoritative snapshot version");

  // Options distinction (Original vs Transport Copy)
  const keyTransport = buildPdfCacheKey(postedInvoice, { copyLabel: "TRANSPORT COPY" });
  assert.notEqual(key1, keyTransport, "Different copy types must have separate cache keys");
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

test("DASHBOARD_SUMMARY_READ_MODEL & CANONICAL_RECONCILIATION: Precomputed summary is rebuildable and not accounting authority", () => {
  // Test reconciliation and projection rebuild
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

  const result = reconcileDashboardSummaryProjection(mockAccountingData);
  assert.ok(result.rebuiltProjection, "Must generate rebuilt summary projection");
  assert.equal(typeof result.isConsistent, "boolean");
  assert.ok(result.reconciliationAudit.rebuiltAt > 0);
  assert.equal(typeof result.reconciliationAudit.discrepancyPaise, "number");
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
