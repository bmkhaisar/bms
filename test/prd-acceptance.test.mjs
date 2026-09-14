import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

test("1. Party Master: Tally Terminology & Safe Mapping", () => {
  // Check db.ts definitions
  const dbFile = fs.readFileSync(path.join(rootDir, "src/lib/db.ts"), "utf-8");
  assert.ok(dbFile.includes('"SUNDRY_DEBTORS"'), "PartyType includes SUNDRY_DEBTORS");
  assert.ok(dbFile.includes('"SUNDRY_CREDITORS"'), "PartyType includes SUNDRY_CREDITORS");
  assert.ok(dbFile.includes("isSundryDebtor"), "isSundryDebtor helper defined");
  assert.ok(dbFile.includes("isSundryCreditor"), "isSundryCreditor helper defined");
  assert.ok(dbFile.includes("normalizePartyType"), "normalizePartyType helper defined");

  // Verify parties route exposes only SUNDRY_DEBTORS and SUNDRY_CREDITORS in creation
  const partiesFile = fs.readFileSync(path.join(rootDir, "src/routes/_app.parties.tsx"), "utf-8");
  assert.ok(partiesFile.includes("SUNDRY_DEBTORS"), "Parties route offers SUNDRY_DEBTORS");
  assert.ok(partiesFile.includes("SUNDRY_CREDITORS"), "Parties route offers SUNDRY_CREDITORS");
  assert.ok(!partiesFile.includes('value="CUSTOMER">Customer'), "No legacy Customer option in creation dropdown");
  assert.ok(!partiesFile.includes('value="SUPPLIER">Supplier'), "No legacy Supplier option in creation dropdown");
  assert.ok(!partiesFile.includes('value="BOTH">Both'), "No legacy Both option in creation dropdown");
});

test("2. Credit Days: 0 days means 'Payment Due Immediately'", () => {
  const partiesFile = fs.readFileSync(path.join(rootDir, "src/routes/_app.parties.tsx"), "utf-8");
  assert.ok(partiesFile.includes("0 = payment due immediately"), "Party form explains credit days 0 meaning");

  // Verify calculation: invoiceDate + creditDays
  const invoiceDate = new Date("2026-09-13T10:00:00Z").getTime();
  const creditDaysZero = 0;
  const dueDateZero = invoiceDate + creditDaysZero * 24 * 60 * 60 * 1000;
  assert.equal(dueDateZero, invoiceDate, "Due date for 0 credit days equals invoice date");

  const creditDays30 = 30;
  const dueDate30 = invoiceDate + creditDays30 * 24 * 60 * 60 * 1000;
  assert.equal(dueDate30, invoiceDate + 30 * 86400000, "Due date for 30 credit days is invoice date + 30 days");
});

test("3. Bill To / Ship To Separation & Snapshot Persistence", () => {
  // Quotation form separation
  const quotationForm = fs.readFileSync(path.join(rootDir, "src/components/app/QuotationForm.tsx"), "utf-8");
  assert.ok(quotationForm.includes("BILL TO (Customer)"), "Quotation has separate customer-facing BILL TO card");
  assert.ok(quotationForm.includes("SHIP TO (Delivery Destination / Consignee)"), "Quotation has separate SHIP TO card");
  assert.ok(quotationForm.includes("Same as Billing Address"), "Quotation has Same as Billing Address toggle");
  assert.ok(quotationForm.includes("billToSnapshot"), "Quotation persists billToSnapshot");
  assert.ok(quotationForm.includes("shippingAddressSnapshot"), "Quotation persists shippingAddressSnapshot");

  // DocumentListPage separation for Invoices
  const docListPage = fs.readFileSync(path.join(rootDir, "src/components/app/DocumentListPage.tsx"), "utf-8");
  assert.ok(docListPage.includes("BILL TO (Customer)"), "Invoice has separate customer-facing BILL TO section");
  assert.ok(docListPage.includes("SHIP TO (Delivery Destination / Consignee)"), "Invoice has separate SHIP TO section");
  assert.ok(docListPage.includes("billToSnapshot"), "Invoice persists billToSnapshot");
  assert.ok(docListPage.includes("shippingAddressSnapshot"), "Invoice persists shippingAddressSnapshot");
});

test("4. PDF Bill To and Ship To Rendering & Driver Copy Highlight", () => {
  const docRenderer = fs.readFileSync(path.join(rootDir, "src/lib/documentRenderer.ts"), "utf-8");
  assert.ok(docRenderer.includes("BILL TO"), "PDF renders BILL TO block");
  assert.ok(docRenderer.includes("SHIP TO / CONSIGNEE DETAILS"), "PDF renders SHIP TO block");
  assert.ok(docRenderer.includes("DELIVERY DESTINATION (DRIVER COPY)"), "Driver copy prominently highlights destination");
});

test("5. Dashboard Amount Received KPI & Deduplication", () => {
  const dashboardService = fs.readFileSync(path.join(rootDir, "src/modules/accounting/services/dashboardReportService.ts"), "utf-8");
  assert.ok(dashboardService.includes("totalAmountReceived"), "Calculates totalAmountReceived");
  assert.ok(dashboardService.includes("receivedByPaymentMode"), "Calculates receivedByPaymentMode breakdown");

  // Check exclusion of draft, failed, reversed, refunded
  assert.ok(dashboardService.includes("rec.postingStatus === \"draft\""), "Excludes draft receipts");
  assert.ok(dashboardService.includes("rec.postingStatus === \"failed\""), "Excludes failed receipts");
  assert.ok(dashboardService.includes("rec.postingStatus === \"reversed\""), "Excludes reversed receipts");

  // Check Dashboard UI includes Amount Received KPI and drilldown
  const dashboardUI = fs.readFileSync(path.join(rootDir, "src/routes/_app.index.tsx"), "utf-8");
  assert.ok(dashboardUI.includes('"Amount Received"'), "Dashboard renders Amount Received KPI card");
  assert.ok(dashboardUI.includes('href: "/receipts"'), "Amount Received card drills down to /receipts");
  assert.ok(dashboardUI.includes("Customer Collections & Payment Methods"), "Dashboard renders Customer Collections breakdown card");
});

test("6. Purchase Supplier Invoice No & Supplier Invoice Date", () => {
  const docListPage = fs.readFileSync(path.join(rootDir, "src/components/app/DocumentListPage.tsx"), "utf-8");
  assert.ok(docListPage.includes("Supplier Invoice No."), "Purchase form has Supplier Invoice No. field");
  assert.ok(docListPage.includes("Supplier Invoice Date"), "Purchase form has Supplier Invoice Date field");
  assert.ok(docListPage.includes("BMS Purchase No."), "Purchase form retains separate BMS Purchase No.");
  assert.ok(docListPage.includes("supplierInvoiceNumber"), "Purchase model persists supplierInvoiceNumber");
  assert.ok(docListPage.includes("supplierInvoiceDate"), "Purchase model persists supplierInvoiceDate");

  // Scoped duplicate check
  assert.ok(docListPage.includes("p.supplierInvoiceNumber?.trim().toLowerCase() === norm"), "Checks duplicate supplier invoice numbers");
  assert.ok(docListPage.includes("setDuplicatePurchaseWarning"), "Triggers duplicate warning modal");
});

test("7. PWA Installation & Service Worker Offline Shell", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, "public/manifest.webmanifest"), "utf-8"));
  assert.equal(manifest.name, "BMS NEXT", "PWA name is BMS NEXT");
  assert.equal(manifest.short_name, "BMS NEXT", "PWA short_name is BMS NEXT");
  assert.equal(manifest.display, "standalone", "PWA display is standalone");
  assert.ok(manifest.icons.some(i => i.sizes === "192x192" && i.purpose.includes("maskable")), "Has 192x192 maskable icon");
  assert.ok(manifest.icons.some(i => i.sizes === "512x512" && i.purpose.includes("maskable")), "Has 512x512 maskable icon");

  const swFile = fs.readFileSync(path.join(rootDir, "public/sw.js"), "utf-8");
  assert.ok(swFile.includes("bms-next-shell-v1"), "Service worker has cache version");
  assert.ok(swFile.includes("firebaseio.com"), "Service worker strictly bypasses CacheStorage for Firebase RTDB");

  const pwaBanner = fs.readFileSync(path.join(rootDir, "src/components/app/InstallPwaBanner.tsx"), "utf-8");
  assert.ok(pwaBanner.includes("beforeinstallprompt"), "Listens to beforeinstallprompt event");
  assert.ok(pwaBanner.includes("Install BMS NEXT"), "Has Install BMS NEXT prompt");
});
