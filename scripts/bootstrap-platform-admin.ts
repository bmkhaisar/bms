/**
 * One-time Platform Administrator Bootstrap Script (TypeScript)
 * 
 * Usage:
 *   npx tsx scripts/bootstrap-platform-admin.ts
 *   or npm run bootstrap:admin
 * 
 * Invariants:
 * - Authoritative target: UID BOkCLXp08tVmRHICTArgpReVh5Y2 (maaz@admin.com).
 * - Verifies user exists in Firebase Auth.
 * - Merges { platformAdmin: true } into existing claims without overwriting other claims.
 * - Prints success or failure status only.
 * - Never logs or exposes credentials, tokens, or private keys.
 * - If Firebase Admin credentials are unavailable, outputs PLATFORM_ADMIN_CLAIM_SETUP = BLOCKED_BY_CREDENTIALS.
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// 1. Read environment variables from .env if present
const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf8");
  for (const line of envContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.substring(0, eqIdx).trim();
      let val = trimmed.substring(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.substring(1, val.length - 1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  }
}

const targetUid = process.env.INITIAL_PLATFORM_ADMIN_UID || "BOkCLXp08tVmRHICTArgpReVh5Y2";
const expectedEmail = process.env.INITIAL_PLATFORM_ADMIN_EMAIL || "maaz@admin.com";

const rawPrivateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").trim();
const clientEmail = (process.env.FIREBASE_ADMIN_CLIENT_EMAIL || "").trim();
const projectId = (process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || "").trim();
const databaseURL = (process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL || "").trim();

if (!rawPrivateKey || !clientEmail || !projectId) {
  console.log("=================================================");
  console.log("PLATFORM_ADMIN_CLAIM_SETUP = BLOCKED_BY_CREDENTIALS");
  console.log("=================================================");
  console.log("Reason: FIREBASE_ADMIN_PRIVATE_KEY or FIREBASE_ADMIN_CLIENT_EMAIL is missing in .env.");
  console.log(`Configured Platform Admin UID: ${targetUid}`);
  console.log(`Expected Platform Admin Email: ${expectedEmail}`);
  console.log("Once Firebase Admin service account credentials are provided, re-run this script.");
  process.exit(0);
}

// Normalize private key
let normalizedKey = rawPrivateKey;
if (
  (normalizedKey.startsWith('"') && normalizedKey.endsWith('"')) ||
  (normalizedKey.startsWith("'") && normalizedKey.endsWith("'"))
) {
  normalizedKey = normalizedKey.substring(1, normalizedKey.length - 1).trim();
}
if (normalizedKey.includes("\\n")) {
  normalizedKey = normalizedKey.replace(/\\n/g, "\n");
}

if (!normalizedKey.includes("-----BEGIN PRIVATE KEY-----") || !normalizedKey.includes("-----END PRIVATE KEY-----")) {
  console.error("=================================================");
  console.error("PLATFORM_ADMIN_CLAIM_SETUP = FAILED");
  console.error("=================================================");
  console.error("Error: FIREBASE_ADMIN_PRIVATE_KEY is malformed (missing BEGIN/END markers).");
  process.exit(1);
}

// Initialize Firebase Admin SDK and set custom claim
try {
  const admin = await import("firebase-admin");

  const app = admin.default.apps.length
    ? admin.default.app()
    : admin.default.initializeApp({
        credential: admin.default.credential.cert({
          projectId,
          clientEmail,
          privateKey: normalizedKey,
        }),
        databaseURL,
      });

  const auth = app.auth();

  console.log(`Verifying target user UID: ${targetUid}...`);
  const userRecord = await auth.getUser(targetUid);

  if (expectedEmail && userRecord.email && userRecord.email.toLowerCase() !== expectedEmail.toLowerCase()) {
    console.warn(`Note: Target user email (${userRecord.email}) does not match expected (${expectedEmail}). Proceeding with authoritative UID.`);
  }

  const existingClaims = userRecord.customClaims || {};

  // Merge platformAdmin claim without destroying other claims
  const updatedClaims = {
    ...existingClaims,
    platformAdmin: true,
  };

  await auth.setCustomUserClaims(targetUid, updatedClaims);

  console.log("=================================================");
  console.log("PLATFORM_ADMIN_CLAIM_SETUP = SUCCESS");
  console.log("=================================================");
  console.log(`Successfully assigned custom claim { platformAdmin: true } to UID: ${targetUid}`);
  console.log("The user should sign in or call user.getIdToken(true) to refresh claims.");
  process.exit(0);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : "Unknown error";
  console.error("=================================================");
  console.error("PLATFORM_ADMIN_CLAIM_SETUP = FAILED");
  console.error("=================================================");
  console.error("Error setting custom claim:", msg);
  process.exit(1);
}
