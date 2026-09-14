#!/usr/bin/env node

/** Read-only company foundation audit. Never prints credentials or record values. */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const companyId = process.argv.find((arg) => arg.startsWith("--company="))?.slice("--company=".length);
if (!companyId || !/^comp_[A-Za-z0-9_-]+$/.test(companyId)) {
  console.error("Usage: node scripts/audit-company-foundation.mjs --company=<company-id>");
  process.exit(1);
}

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const splitAt = trimmed.indexOf("=");
    if (splitAt < 1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

const scalar = (value) => String(value || "").trim().replace(/^(["'])(.*)\1$/, "$2");
const privateKey = scalar(process.env.FIREBASE_ADMIN_PRIVATE_KEY).replace(/\\n/g, "\n");

try {
  const { default: admin } = await import("firebase-admin");
  const app = admin.apps[0] || admin.initializeApp({
    credential: admin.credential.cert({
      projectId: scalar(process.env.FIREBASE_ADMIN_PROJECT_ID),
      clientEmail: scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      privateKey,
    }),
    databaseURL: scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL),
  });
  const [companySnapshot, dataSnapshot, membershipsSnapshot] = await Promise.all([
    app.database().ref(`companies/${companyId}`).once("value"),
    app.database().ref(`companyData/${companyId}`).once("value"),
    app.database().ref(`memberships/${companyId}`).once("value"),
  ]);
  const data = dataSnapshot.val() || {};
  const memberships = membershipsSnapshot.val() || {};
  const quotations = Object.values(data.quotations || {});
  console.log(JSON.stringify({
    companyExists: companySnapshot.exists(),
    companyDataExists: dataSnapshot.exists(),
    mainBranchExists: Boolean(data.branches?.br_main),
    financialYearCount: Object.keys(data.financialYears || {}).length,
    accountGroupCount: Object.keys(data.accountGroups || {}).length,
    ledgerCount: Object.keys(data.ledgers || {}).length,
    productCount: Object.keys(data.products || {}).length,
    quotationCount: quotations.length,
    quotationsUsingFirebaseEmptyItemsSemantics: quotations.filter((quotation) => !Array.isArray(quotation?.items)).length,
    quotationsUsingFirebaseEmptyExtraChargesSemantics: quotations.filter((quotation) => !Array.isArray(quotation?.extraCharges)).length,
    activeMembershipCount: Object.values(memberships).filter((entry) => entry?.status === "active").length,
  }, null, 2));
  process.exit(0);
} catch {
  console.error("COMPANY_FOUNDATION_AUDIT_FAILED");
  process.exit(1);
}
