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
      projectId: scalar(process.env.FIREBASE_ADMIN_PROJECT_ID),
      clientEmail: scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
      privateKey,
    }),
    databaseURL: scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL),
  });

  const db = app.database();
  const companyArg = process.argv.find((arg) => arg.startsWith("--company="))?.slice("--company=".length);
  
  let targetCompanyIds = [];
  if (companyArg) {
    targetCompanyIds = [companyArg];
  } else {
    const compSnap = await db.ref("companies").once("value");
    const comps = compSnap.val() || {};
    targetCompanyIds = Object.keys(comps);
  }

  for (const companyId of targetCompanyIds) {
    console.log(`\nReconciling ledger currentBalance cache for company: ${companyId}`);
    
    const [ledgersSnap, vouchersSnap] = await Promise.all([
      db.ref(`companyData/${companyId}/ledgers`).once("value"),
      db.ref(`companyData/${companyId}/vouchers`).once("value"),
    ]);

    const ledgers = ledgersSnap.val() || {};
    const vouchers = vouchersSnap.val() || {};
    const voucherList = Object.values(vouchers);

    // Calculate canonical movements from posted vouchers
    const movements = {};
    for (const [lId, l] of Object.entries(ledgers)) {
      const openSign = (l.openingBalanceType || "dr").toLowerCase() === "cr" ? -1 : 1;
      movements[lId] = {
        name: l.name,
        openingSigned: Math.abs(l.openingBalance || 0) * openSign,
        dr: 0,
        cr: 0,
        storedCurrentBalance: l.currentBalance,
      };
    }

    for (const v of voucherList) {
      if (v.status !== "posted") continue;
      for (const line of v.lines || []) {
        if (!movements[line.ledgerId]) {
          movements[line.ledgerId] = {
            name: `Unknown (${line.ledgerId})`,
            openingSigned: 0,
            dr: 0,
            cr: 0,
            storedCurrentBalance: undefined,
          };
        }
        movements[line.ledgerId].dr += line.debit || 0;
        movements[line.ledgerId].cr += line.credit || 0;
      }
    }

    const updates = {};
    let staleCount = 0;

    for (const [lId, m] of Object.entries(movements)) {
      const canonicalSigned = m.openingSigned + m.dr - m.cr;
      const isStale = m.storedCurrentBalance !== canonicalSigned;
      
      console.log(`- Ledger "${m.name}" (${lId}):`);
      console.log(`    Opening: ₹${(m.openingSigned / 100).toFixed(2)} | Dr: ₹${(m.dr / 100).toFixed(2)} | Cr: ₹${(m.cr / 100).toFixed(2)}`);
      console.log(`    Stored Cache:  ₹${((m.storedCurrentBalance || 0) / 100).toFixed(2)} (${m.storedCurrentBalance ?? "undefined"})`);
      console.log(`    Canonical:     ₹${(canonicalSigned / 100).toFixed(2)} (${canonicalSigned})`);
      console.log(`    Cache Status:  ${isStale ? "STALE -> REBUILDING" : "ACCURATE"}`);

      if (isStale && ledgers[lId]) {
        updates[`companyData/${companyId}/ledgers/${lId}/currentBalance`] = canonicalSigned;
        updates[`companyData/${companyId}/ledgers/${lId}/updatedAt`] = Date.now();
        staleCount++;
      }
    }

    if (Object.keys(updates).length > 0) {
      console.log(`\nWriting updated derived currentBalance cache for ${staleCount} ledger(s)...`);
      await db.ref().update(updates);
      console.log(`Successfully reconciled ${staleCount} ledger currentBalance cache entries in Firebase RTDB.`);
    } else {
      console.log(`\nAll ledger currentBalance cache entries are already fully synchronized.`);
    }
  }

  process.exit(0);
} catch (err) {
  console.error("Reconciliation error:", err);
  process.exit(1);
}
