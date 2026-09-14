#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    let value = trimmed.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const scalar = (value) => {
  let result = String(value || "").trim();
  if ((result.startsWith('"') && result.endsWith('"')) || (result.startsWith("'") && result.endsWith("'"))) result = result.slice(1, -1).trim();
  return result;
};
const args = new Map(process.argv.slice(2).map((arg) => {
  const index = arg.indexOf("=");
  return index < 0 ? [arg, true] : [arg.slice(0, index), arg.slice(index + 1)];
}));
const companyId = scalar(args.get("--company"));
const includeProducts = args.has("--include-products");
const confirmation = scalar(args.get("--confirm"));
const execute = Boolean(confirmation);
if (!companyId) {
  console.error("Usage: npm run reset:company-data -- --company=<company-id> [--include-products] [--confirm=RESET:<company-id>]");
  process.exit(2);
}
if (execute && confirmation !== `RESET:${companyId}`) {
  console.error("Confirmation refused. The exact token is RESET:<company-id>.");
  process.exit(2);
}

const projectId = scalar(process.env.FIREBASE_ADMIN_PROJECT_ID);
const clientEmail = scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL);
const databaseURL = scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL);
let privateKey = scalar(process.env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, "\n");
if (!projectId || !clientEmail || !privateKey || !databaseURL) {
  console.error("Firebase Admin environment is incomplete. No data was changed.");
  process.exit(1);
}

const admin = (await import("firebase-admin")).default;
const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert({ projectId, clientEmail, privateKey }), databaseURL });
const adminDb = app.database();
const companySnap = await adminDb.ref(`companies/${companyId}`).once("value");
if (!companySnap.exists()) {
  console.error("Company does not exist. No data was changed.");
  process.exit(1);
}

const operationalCollections = [
  "parties", "customers", "suppliers", "productSizes", "quotations", "invoices", "purchases", "receipts", "payments",
  "vouchers", "voucherLines", "voucherMutations", "allocations", "receiptAllocations", "paymentAllocations", "stockMovements",
  "transactionSummaries", "reportMaterializations", "legacyPartyMappings", "partyMutations", "docCounters", "partyNumbering",
];
if (includeProducts) operationalCollections.push("products", "categories");
const dataSnap = await adminDb.ref(`companyData/${companyId}`).once("value");
const companyData = dataSnap.val() || {};
const backup = {};
const counts = {};
for (const collection of operationalCollections) {
  backup[collection] = companyData[collection] ?? null;
  counts[collection] = companyData[collection] && typeof companyData[collection] === "object" ? Object.keys(companyData[collection]).length : 0;
}
console.log(JSON.stringify({ mode: execute ? "EXECUTE" : "DRY_RUN", companyId, includeProducts, collections: counts }, null, 2));
if (!execute) {
  console.log(`Dry run only. To execute, repeat with --confirm=RESET:${companyId}`);
  process.exit(0);
}

const backupDir = resolve(process.cwd(), ".backups", "company-resets");
mkdirSync(backupDir, { recursive: true });
const resetAt = Date.now();
const backupPath = resolve(backupDir, `${companyId}-${resetAt}.json`);
writeFileSync(backupPath, JSON.stringify({ companyId, resetAt, includeProducts, data: backup }, null, 2), { encoding: "utf8", mode: 0o600 });
const updates = {};
for (const collection of operationalCollections) updates[`companyData/${companyId}/${collection}`] = null;
updates[`companyData/${companyId}/operationalReset`] = { completedAt: resetAt, includeProducts, performedBy: "admin-cli", backupFile: backupPath.split(/[\\/]/).pop() };
updates[`companyData/${companyId}/auditLogs/reset_${resetAt}`] = { id: `reset_${resetAt}`, entityType: "company", action: "controlled_operational_reset", timestamp: resetAt, performedBy: "admin-cli", details: { includeProducts, collections: operationalCollections } };
await adminDb.ref().update(updates);
console.log(`Reset completed. Restricted local backup written: ${backupPath}`);
