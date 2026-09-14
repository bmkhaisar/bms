#!/usr/bin/env node

/**
 * Additive legacy-company foundation repair.
 * Dry-run by default; execute with --confirm=REPAIR:<company-id>.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SYSTEM_ACCOUNT_GROUPS, getDefaultSystemLedgers } from "../src/modules/accounting/defaultGroups.ts";

const companyId = process.argv.find((arg) => arg.startsWith("--company="))?.slice("--company=".length);
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice("--confirm=".length);
if (!companyId || !/^comp_[A-Za-z0-9_-]+$/.test(companyId)) {
  console.error("Usage: node scripts/repair-company-foundation.mjs --company=<company-id> [--confirm=REPAIR:<company-id>]");
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
  const database = app.database();
  const [companySnapshot, dataSnapshot, membershipsSnapshot] = await Promise.all([
    database.ref(`companies/${companyId}`).once("value"),
    database.ref(`companyData/${companyId}`).once("value"),
    database.ref(`memberships/${companyId}`).once("value"),
  ]);
  if (!companySnapshot.exists()) throw new Error("Company not found");

  const existing = dataSnapshot.val() || {};
  const memberships = membershipsSnapshot.val() || {};
  const now = Date.now();
  const defaultLedgers = getDefaultSystemLedgers(companyId, now);
  const missingGroups = SYSTEM_ACCOUNT_GROUPS.filter((group) => !existing.accountGroups?.[group.id]);
  const missingLedgers = defaultLedgers.filter((ledger) => !existing.ledgers?.[ledger.id]);
  const missingMainBranch = !existing.branches?.br_main;
  const activeMemberships = Object.entries(memberships).filter(([, value]) => value?.status === "active");

  const manifest = {
    companyExists: true,
    missingMainBranch,
    missingAccountGroupCount: missingGroups.length,
    missingSystemLedgerCount: missingLedgers.length,
    activeMembershipsToNormalize: activeMemberships.filter(([, value]) => value?.branchIds?.br_main !== true).length,
    mode: confirmation === `REPAIR:${companyId}` ? "execute" : "dry-run",
  };
  console.log(JSON.stringify(manifest, null, 2));
  if (confirmation !== `REPAIR:${companyId}`) process.exit(0);

  const auditId = `audit_${now}_company_foundation_repair`;
  await database.ref(`companyData/${companyId}`).transaction((current) => {
    if (!current) return current;
    current.branches ||= {};
    current.accountGroups ||= {};
    current.ledgers ||= {};
    current.auditLogs ||= {};
    current.branches.br_main ||= {
      id: "br_main",
      companyId,
      name: "Main Branch",
      code: "MAIN",
      isHeadOffice: true,
      active: true,
      createdAt: now,
      createdBy: "system_foundation_repair",
    };
    for (const group of missingGroups) current.accountGroups[group.id] ||= { ...group, companyId, createdAt: now };
    for (const ledger of missingLedgers) current.ledgers[ledger.id] ||= { ...ledger, updatedAt: now };
    current.auditLogs[auditId] ||= {
      id: auditId,
      entityType: "company",
      entityId: companyId,
      action: "repair_operational_foundation",
      performedBy: "system_foundation_repair",
      timestamp: now,
      details: {
        mainBranchCreated: missingMainBranch,
        accountGroupsCreated: missingGroups.length,
        systemLedgersCreated: missingLedgers.length,
      },
    };
    return current;
  }, undefined, false);

  const memberUpdates = {};
  for (const [uid, membership] of activeMemberships) {
    if (membership?.branchIds?.br_main !== true) memberUpdates[`memberships/${companyId}/${uid}/branchIds/br_main`] = true;
  }
  if (Object.keys(memberUpdates).length) await database.ref().update(memberUpdates);
  console.log("COMPANY_FOUNDATION_REPAIR = COMPLETE");
  process.exit(0);
} catch (error) {
  console.error(`COMPANY_FOUNDATION_REPAIR = FAILED (${error instanceof Error ? error.message : "unknown error"})`);
  process.exit(1);
}
