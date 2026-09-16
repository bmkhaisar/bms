#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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
      projectId: scalar(process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID),
      clientEmail: scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      privateKey,
    }),
    databaseURL: scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL),
  });

  const db = app.database();
  const compSnap = await db.ref("companies").once("value");
  const companies = compSnap.val() || {};

  console.log("=== REBUILDING & RECONCILING DERIVED LEDGER BALANCES ===");
  console.log(`Found ${Object.keys(companies).length} companies.`);

  for (const companyId of Object.keys(companies)) {
    console.log(`\nProcessing Company: ${companyId} (${companies[companyId]?.name})`);
    
    const ledgersSnap = await db.ref(`companyData/${companyId}/ledgers`).once("value");
    const ledgers = ledgersSnap.val() || {};

    const vouchersSnap = await db.ref(`companyData/${companyId}/vouchers`).once("value");
    const vouchers = vouchersSnap.val() || {};
    const voucherList = Object.values(vouchers);

    const postedDrMap = new Map();
    const postedCrMap = new Map();

    for (const v of voucherList) {
      if (v.status !== "posted") continue;
      for (const line of v.lines || []) {
        const lId = line.ledgerId;
        postedDrMap.set(lId, (postedDrMap.get(lId) || 0) + (line.debit || 0));
        postedCrMap.set(lId, (postedCrMap.get(lId) || 0) + (line.credit || 0));
      }
    }

    const updates = {};
    let repairedCount = 0;
    const now = Date.now();

    for (const [lId, ledger] of Object.entries(ledgers)) {
      const rawOpening = Math.abs(ledger.openingBalance || 0);
      const openingType = (ledger.openingBalanceType || "dr").toLowerCase() === "cr" ? "cr" : "dr";
      const openingSigned = openingType === "dr" ? rawOpening : -rawOpening;

      const pDr = postedDrMap.get(lId) || 0;
      const pCr = postedCrMap.get(lId) || 0;
      const derivedBalance = openingSigned + pDr - pCr;

      const storedBalance = ledger.currentBalance !== undefined ? ledger.currentBalance : 0;
      const needsRepair = storedBalance !== derivedBalance;

      console.log(`  Ledger: "${ledger.name}" (${lId})`);
      console.log(`    Opening Signed: ₹${(openingSigned / 100).toFixed(2)}, Dr: ₹${(pDr / 100).toFixed(2)}, Cr: ₹${(pCr / 100).toFixed(2)}`);
      console.log(`    Derived: ₹${(derivedBalance / 100).toFixed(2)} | Stored: ₹${(storedBalance / 100).toFixed(2)} | ${needsRepair ? "NEEDS REPAIR" : "OK"}`);

      if (needsRepair) {
        updates[`companyData/${companyId}/ledgers/${lId}/currentBalance`] = derivedBalance;
        updates[`companyData/${companyId}/ledgers/${lId}/updatedAt`] = now;
        repairedCount++;
      }
    }

    if (Object.keys(updates).length > 0) {
      console.log(`  Writing ${Object.keys(updates).length / 2} reconciled ledger balances to Firebase...`);
      await db.ref().update(updates);
      console.log(`  Successfully repaired ${repairedCount} ledgers for company ${companyId}.`);
    } else {
      console.log(`  All ledgers already in perfect sync with posted vouchers.`);
    }
  }

  console.log("\nReconciliation complete.");
  process.exit(0);
} catch (err) {
  console.error("Reconciliation error:", err);
  process.exit(1);
}
