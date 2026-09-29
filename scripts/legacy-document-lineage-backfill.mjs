/**
 * Standalone CLI: Legacy Document Lineage Backfill Migration (PRD §§ 54-56)
 * 
 * Usage:
 *   node scripts/legacy-document-lineage-backfill.mjs <companyId> [--dry-run] [--apply]
 * 
 * Safety Invariants:
 * 1. Default mode is DRY-RUN (read-only audit).
 * 2. Scope is restricted strictly to the specified companyId (never touches other tenants).
 * 3. Never rewrites already-valid lineage.
 * 4. Never guesses: ambiguous records are flagged as LINEAGE_UNRESOLVED.
 * 5. Requires explicit --apply flag to write changes.
 * 6. Generates persistent audit logs for all applied updates.
 */

import admin from "firebase-admin";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const args = process.argv.slice(2);
const companyIdArg = args.find((a) => !a.startsWith("--"));
const isApply = args.includes("--apply");
const isDryRun = !isApply || args.includes("--dry-run");

if (!companyIdArg) {
  console.error("Usage: node scripts/legacy-document-lineage-backfill.mjs <companyId> [--dry-run] [--apply]");
  process.exit(1);
}

const companyId = companyIdArg.trim();

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

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || resolve(process.cwd(), "serviceAccountKey.json");
  if (existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf-8"));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || "https://bms-h70209-default-rtdb.asia-southeast1.firebasedatabase.app",
    });
  } else if (process.env.FIREBASE_ADMIN_PROJECT_ID && privateKey) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: scalar(process.env.FIREBASE_ADMIN_PROJECT_ID),
        clientEmail: scalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL),
        privateKey,
      }),
      databaseURL: scalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL),
    });
  } else {
    admin.initializeApp({
      databaseURL: process.env.VITE_FIREBASE_DATABASE_URL || "http://127.0.0.1:9000?ns=bms-h70209-default-rtdb",
    });
  }
}

const db = admin.database();

async function main() {
  console.log("================================================================================");
  console.log("LEGACY DOCUMENT LINEAGE BACKFILL MIGRATION");
  console.log(`Target Company: ${companyId}`);
  console.log(`Mode:           ${isApply ? "APPLY (LIVE WRITES ENABLED)" : "DRY-RUN (AUDIT ONLY)"}`);
  console.log("================================================================================\n");

  const companyRoot = `companyData/${companyId}`;
  
  // 1. Fetch Invoices, Quotations, and Receipts
  const [invoicesSnap, quotationsSnap, receiptsSnap] = await Promise.all([
    db.ref(`${companyRoot}/invoices`).once("value"),
    db.ref(`${companyRoot}/quotations`).once("value"),
    db.ref(`${companyRoot}/receipts`).once("value"),
  ]);

  const invoices = invoicesSnap.val() || {};
  const quotations = quotationsSnap.val() || {};
  const receipts = receiptsSnap.val() || {};

  const invoiceList = Object.entries(invoices).map(([id, inv]) => ({ ...inv, id: inv?.id || id }));
  const quotationList = Object.entries(quotations).map(([id, q]) => ({ ...q, id: q?.id || id }));
  const receiptList = Object.entries(receipts).map(([id, r]) => ({ ...r, id: r?.id || id }));

  console.log(`Loaded ${invoiceList.length} invoices, ${quotationList.length} quotations, ${receiptList.length} receipts.`);

  const repairCandidates = [];
  const unresolvedItems = [];
  let alreadyValidCount = 0;

  for (const inv of invoiceList) {
    const hasSourceQuotation = Boolean(inv.sourceQuotationId || inv.convertedFromQuotationId);
    const hasAmendedFrom = Boolean(inv.amendedFromId || inv.amendedFromNumber);
    const hasOriginalDoc = Boolean(inv.originalDocumentId || inv.originalDocumentNumber);

    if (hasSourceQuotation || hasAmendedFrom || hasOriginalDoc) {
      alreadyValidCount++;
      continue;
    }

    // Direct Quotation Match
    const directQuotationMatches = quotationList.filter((q) => {
      const partyMatches = !inv.customerId || !q.customerId || inv.customerId === q.customerId;
      if (!partyMatches) return false;
      return (
        q.convertedInvoiceId === inv.id ||
        (q.convertedInvoiceNumber && inv.number && q.convertedInvoiceNumber.toLowerCase() === inv.number.toLowerCase())
      );
    });

    if (directQuotationMatches.length === 1) {
      const q = directQuotationMatches[0];
      repairCandidates.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        newMetadata: {
          sourceQuotationId: q.id,
          sourceQuotationNumber: q.number,
          amendedFromId: `inv_from_${q.id}`,
          amendedFromNumber: q.number,
        },
        evidenceUsed: `Direct quotation conversion linkage: Quotation ${q.number} (${q.id}) recorded convertedInvoiceId=${q.convertedInvoiceId}`,
      });
      continue;
    }

    // Receipt references
    const receiptReferences = new Set();
    for (const r of receiptList) {
      if (r.customerId && inv.customerId && r.customerId !== inv.customerId) continue;
      if (r.allocatedInvoices) {
        for (const a of r.allocatedInvoices) {
          const tid = String(a.invoiceId || a.invoiceNumber || "").trim();
          if (tid.startsWith("inv_from_")) {
            receiptReferences.add(tid.replace(/^inv_from_/, ""));
          }
        }
      }
      if (r.invoiceId && String(r.invoiceId).startsWith("inv_from_")) {
        receiptReferences.add(String(r.invoiceId).replace(/^inv_from_/, ""));
      }
    }

    const matchingQuotations = quotationList.filter((q) => {
      const partyMatches = !inv.customerId || !q.customerId || inv.customerId === q.customerId;
      if (!partyMatches) return false;
      return receiptReferences.has(q.id) || (q.number && receiptReferences.has(q.number.toLowerCase()));
    });

    if (matchingQuotations.length === 1) {
      const q = matchingQuotations[0];
      repairCandidates.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        newMetadata: {
          sourceQuotationId: q.id,
          sourceQuotationNumber: q.number,
          amendedFromId: `inv_from_${q.id}`,
          amendedFromNumber: q.number,
        },
        evidenceUsed: `Receipt allocation reference to inv_from_${q.id} matching quotation ${q.number}`,
      });
      continue;
    }

    if (matchingQuotations.length > 1) {
      unresolvedItems.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        reason: "Multiple matching quotations found for customer receipt tokens",
        candidates: matchingQuotations.map((q) => `${q.number} (${q.id})`),
      });
    }
  }

  console.log(`\nResults Summary:`);
  console.log(`  Already Valid Lineage: ${alreadyValidCount}`);
  console.log(`  Candidates to Repair:  ${repairCandidates.length}`);
  console.log(`  Unresolved Lineage:    ${unresolvedItems.length}`);

  if (repairCandidates.length > 0) {
    console.log(`\nProposed Repairs:`);
    for (const c of repairCandidates) {
      console.log(`  • Invoice ${c.documentNumber} (${c.documentId})`);
      console.log(`    New Metadata:`, JSON.stringify(c.newMetadata));
      console.log(`    Evidence:     ${c.evidenceUsed}`);
    }
  }

  if (unresolvedItems.length > 0) {
    console.log(`\nUnresolved Lineage Items (Will NOT be modified):`);
    for (const u of unresolvedItems) {
      console.log(`  ⚠ Invoice ${u.documentNumber} (${u.documentId}): ${u.reason}`);
      console.log(`    Candidates: ${u.candidates.join(", ")}`);
    }
  }

  if (!isApply) {
    console.log(`\n[DRY RUN COMPLETE] Zero changes applied. To apply these repairs, run with --apply.`);
    process.exit(0);
  }

  // Live Apply Mode
  console.log(`\nApplying ${repairCandidates.length} repairs to Firebase RTDB...`);
  const now = Date.now();
  for (const c of repairCandidates) {
    const invRef = db.ref(`${companyRoot}/invoices/${c.documentId}`);
    await invRef.update({
      ...c.newMetadata,
      updatedAt: now,
    });

    const auditRef = db.ref(`${companyRoot}/lineageMigrationAuditLogs/${c.documentId}_${now}`);
    await auditRef.set({
      companyId,
      documentId: c.documentId,
      documentNumber: c.documentNumber,
      newMetadata: c.newMetadata,
      evidenceUsed: c.evidenceUsed,
      migratedAt: now,
      migratedBy: "cli_migration_script",
    });
  }

  console.log(`[APPLY COMPLETE] Successfully repaired ${repairCandidates.length} records with audit trail.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
