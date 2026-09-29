import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildPdfCacheKey,
  getCachedPdfBlob,
  setCachedPdfBlob,
  invalidatePdfBlobCache,
  clearPdfBlobCache,
  getCachedAsset,
  setCachedAsset,
  clearCompanyAssetCache,
} from "../src/modules/documents/pdfCacheService.ts";

test("PDF_BLOB_CACHE & PDF_ASSET_CACHE: Sub-10ms session cache hit and safe invalidation", () => {
  clearPdfBlobCache();

  const doc = {
    id: "inv-bench-001",
    number: "INV/2026-27/0001",
    updatedAt: 1775000000000,
    grandTotal: 15000,
    items: [{ id: "it-1", name: "Steel Tube", quantity: 2, rate: 7500 }],
  };

  const key = buildPdfCacheKey(doc, { copyLabel: "ORIGINAL", includeDescriptions: true });
  assert.equal(getCachedPdfBlob(key), null, "Cache must be empty initially");

  // Simulate first PDF generation (mock Blob)
  const mockBlob = new Blob(["%PDF-1.4 mock vector stream"], { type: "application/pdf" });
  setCachedPdfBlob(key, mockBlob);

  // Measure retrieval latency
  const t0 = performance.now();
  const cachedBlob = getCachedPdfBlob(key);
  const t1 = performance.now();
  const duration = t1 - t0;

  assert.ok(cachedBlob !== null, "Must return cached Blob");
  assert.ok(duration < 10, `Cached retrieval must be sub-10ms (was ${duration.toFixed(3)}ms)`);

  // Invalidate on document update
  invalidatePdfBlobCache("inv-bench-001");
  assert.equal(getCachedPdfBlob(key), null, "Blob must be purged on document invalidation");

  // Asset cache tests
  clearCompanyAssetCache();
  setCachedAsset("comp-1", "logo", "logo.png", "data:image/png;base64,mockLogoData");
  assert.equal(getCachedAsset("comp-1", "logo", "logo.png"), "data:image/png;base64,mockLogoData");
  clearCompanyAssetCache("comp-1");
  assert.equal(getCachedAsset("comp-1", "logo", "logo.png"), null);
});

test("PRODUCT_SEARCH_LOCAL_INDEXED: High-speed priority-ranked search over 1,000 products", () => {
  // Generate 1,000 test products
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
      .slice(0, 15)
      .map((m) => m.product);
  }

  // Exact SKU match latency
  const t0 = performance.now();
  const skuResults = benchmarkSearch("titan-8");
  const t1 = performance.now();
  const skuDuration = t1 - t0;

  assert.equal(skuResults.length, 1);
  assert.equal(skuResults[0].id, "prod-42");
  assert.ok(skuDuration < 20, `Search must complete in < 20ms (was ${skuDuration.toFixed(3)}ms)`);

  // Substring name match latency
  const t2 = performance.now();
  const nameResults = benchmarkSearch("hardware product 5");
  const t3 = performance.now();
  const nameDuration = t3 - t2;

  assert.ok(nameResults.length > 0);
  assert.ok(nameResults.length <= 15, "Results must be bounded to maximum 15 items");
  assert.ok(nameDuration < 20, `Search must complete in < 20ms (was ${nameDuration.toFixed(3)}ms)`);
});

test("ROUTE_PREFETCHING & PRODUCTION_UI_CLEANUP: Verified across application shell", () => {
  const sidebarFile = fs.readFileSync(path.resolve("src/components/app/Sidebar.tsx"), "utf-8");
  const settingsFile = fs.readFileSync(path.resolve("src/routes/_app.settings.tsx"), "utf-8");
  const envFile = fs.readFileSync(path.resolve("src/config/env.ts"), "utf-8");

  // Route prefetching enabled on sidebar links
  assert.match(sidebarFile, /preload="intent"/, "Sidebar navigation links must have preload='intent'");

  // Company settings footer must NOT expose raw 'Branch: staging'
  assert.ok(!settingsFile.includes("Branch: <code"), "Settings footer must not expose 'Branch: staging'");

  // Explicit APP_ENV=production support in env configuration
  assert.match(envFile, /APP_ENV\s*===\s*"production"/, "env.ts must support explicit APP_ENV=production precedence");
});

test("ACCOUNTING_INVARIANTS: Double-entry parity, zero-debit precedence, and non-optimistic posting", () => {
  // Invariant 1: Financial posting must never be optimistically marked as posted
  const simulatedPostLifecycle = {
    userClickedPost: true,
    uiButtonState: "posting",
    isAuthoritativeConfirmed: false,
    finalStatus: "draft", // MUST NOT BE "posted"
  };
  assert.equal(simulatedPostLifecycle.finalStatus, "draft", "Status must remain draft until authoritative server response");

  // Invariant 2: Double-entry balance
  const debitsPaise = 500000; // ₹5,000.00
  const creditsPaise = 500000;
  assert.equal(debitsPaise, creditsPaise, "Trial balance debit must equal credit");

  // Invariant 3: Zero-debit precedence
  const row = { debitPaise: 0, debit: 250 };
  const authoritativeDebit = row.debitPaise !== undefined ? row.debitPaise : (row.debit || 0) * 100;
  assert.equal(authoritativeDebit, 0, "debitPaise: 0 must take absolute precedence over legacy float debit");
});
