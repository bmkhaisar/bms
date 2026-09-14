#!/usr/bin/env node

/**
 * Diagnostic Verification Script for Firebase Admin Environment
 * 
 * Usage:
 *   npm run verify:firebase-admin
 *   node scripts/verify-firebase-admin.mjs
 * 
 * Verifies server-only Firebase Admin SDK configuration without leaking credentials.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPrivateKey } from "node:crypto";

// 1. Read .env file from project root
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

function normalizeScalar(raw) {
  let value = String(raw || "").trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.substring(1, value.length - 1).trim();
  }
  return value;
}

const projectId = normalizeScalar(process.env.FIREBASE_ADMIN_PROJECT_ID);
const clientProjectId = normalizeScalar(process.env.VITE_FIREBASE_PROJECT_ID);
const clientEmail = normalizeScalar(process.env.FIREBASE_ADMIN_CLIENT_EMAIL);
const rawPrivateKey = (process.env.FIREBASE_ADMIN_PRIVATE_KEY || "").trim();
const databaseURL = normalizeScalar(process.env.FIREBASE_DATABASE_URL || process.env.VITE_FIREBASE_DATABASE_URL);

const targetAdminUid = process.env.INITIAL_PLATFORM_ADMIN_UID || "BOkCLXp08tVmRHICTArgpReVh5Y2";
const targetAdminEmail = process.env.INITIAL_PLATFORM_ADMIN_EMAIL || "maaz@admin.com";

console.log("=================================================");
console.log("       BMS NEXT — FIREBASE ADMIN DIAGNOSTIC      ");
console.log("=================================================");

function pad(label, status) {
  const dots = ".".repeat(Math.max(2, 35 - label.length));
  console.log(`${label}${dots} ${status}`);
}

// Presence checks
pad("Project ID", projectId ? "PRESENT" : "MISSING");
pad("Client Email", clientEmail ? "PRESENT" : "MISSING");
pad("Private Key", rawPrivateKey ? "PRESENT" : "MISSING");
pad("Database URL", databaseURL ? "PRESENT" : "MISSING");

let credParseStatus = "NOT RUN";
let normalizedKey = null;
let keyValid = false;

if (rawPrivateKey) {
  let key = rawPrivateKey;
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.substring(1, key.length - 1).trim();
  }
  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }

  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = key.includes("-----END PRIVATE KEY-----");

  if (hasBegin && hasEnd) {
    try {
      createPrivateKey(key);
      keyValid = true;
      normalizedKey = key;
      credParseStatus = "PASS";
    } catch {
      credParseStatus = "FAIL (PEM key cannot be parsed)";
    }
  } else {
    credParseStatus = "FAIL (Missing PEM BEGIN/END markers)";
  }
} else {
  credParseStatus = "NOT_CONFIGURED";
}

pad("Credential Parse", credParseStatus);

if (clientProjectId && projectId && projectId !== clientProjectId) {
  pad("Project Match", "MISMATCH");
} else if (projectId && clientProjectId) {
  pad("Project Match", "PASS");
}

const emailProjectMatches = Boolean(
  projectId && clientEmail.toLowerCase().endsWith(`@${projectId.toLowerCase()}.iam.gserviceaccount.com`)
);
pad("Service Account Project", emailProjectMatches ? "PASS" : "MISMATCH");

let adminSdkInitStatus = "SKIPPED";
let authAccessStatus = "SKIPPED";
let idTokenVerificationStatus = "SKIPPED";
let platformAdminClaimStatus = "SKIPPED";
let rtdbAccessStatus = "SKIPPED";
let overallStatus = "BLOCKED_BY_CREDENTIALS";

if (projectId && clientEmail && emailProjectMatches && keyValid && normalizedKey && databaseURL) {
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

    adminSdkInitStatus = "PASS";

    // Verify Auth access
    try {
      const auth = app.auth();
      // Safe ping: check if configured admin user exists
      await auth.getUser(targetAdminUid).catch((err) => {
        if (err.code === "auth/user-not-found") {
          return null; // Auth API responded successfully
        }
        throw err;
      });
      authAccessStatus = "PASS";

      // Exercise the same ID-token verification path used by trusted server
      // functions, not only service-account user lookup.
      const apiKey = normalizeScalar(process.env.VITE_FIREBASE_API_KEY);
      if (apiKey) {
        const customToken = await auth.createCustomToken(targetAdminUid);
        const exchange = await fetch(
          `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ token: customToken, returnSecureToken: true }),
          }
        );
        if (!exchange.ok) throw new Error(`ID token exchange failed (${exchange.status})`);
        const exchangeResult = await exchange.json();
        if (!exchangeResult.idToken) throw new Error("ID token exchange returned no token");
        // `true` matches Platform Admin authorization and also checks revocation.
        const verifiedToken = await auth.verifyIdToken(exchangeResult.idToken, true);
        idTokenVerificationStatus = "PASS";
        platformAdminClaimStatus = verifiedToken.platformAdmin === true ? "PASS" : "MISSING";
      } else {
        idTokenVerificationStatus = "SKIPPED (client API key unavailable)";
      }
    } catch (authErr) {
      authAccessStatus = `FAIL (${authErr.code || authErr.message})`;
      idTokenVerificationStatus = `FAIL (${authErr.code || authErr.message})`;
      platformAdminClaimStatus = `FAIL (${authErr.code || authErr.message})`;
    }

    // Verify RTDB access
    try {
      const db = app.database();
      await db.ref(".info/serverTimeOffset").once("value");
      rtdbAccessStatus = "PASS";
    } catch (dbErr) {
      rtdbAccessStatus = `FAIL (${dbErr.message})`;
    }

    if (adminSdkInitStatus === "PASS" && authAccessStatus === "PASS" && idTokenVerificationStatus === "PASS" && platformAdminClaimStatus === "PASS" && rtdbAccessStatus === "PASS") {
      overallStatus = "READY";
    } else {
      overallStatus = "INITIALIZATION_FAILED";
    }
  } catch (initErr) {
    adminSdkInitStatus = `FAIL (${initErr.message})`;
    overallStatus = "INITIALIZATION_FAILED";
  }
} else {
  if (!projectId || !clientEmail || !rawPrivateKey) {
    overallStatus = "BLOCKED_BY_CREDENTIALS";
  } else if (!keyValid) {
    overallStatus = "INVALID_PRIVATE_KEY";
  } else if (!databaseURL) {
    overallStatus = "DATABASE_URL_MISSING";
  }
}

pad("Admin SDK Init", adminSdkInitStatus);
pad("Auth Access", authAccessStatus);
pad("ID Token Verification", idTokenVerificationStatus);
pad("Platform Admin Claim", platformAdminClaimStatus);
pad("RTDB Access", rtdbAccessStatus);

console.log("-------------------------------------------------");
pad("Admin Test Identity", targetAdminUid && targetAdminEmail ? "CONFIGURED" : "MISSING");
console.log("=================================================");
console.log(`FIREBASE_ADMIN_STATUS = ${overallStatus}`);
console.log("=================================================");

if (overallStatus === "BLOCKED_BY_CREDENTIALS") {
  console.log("Reason: FIREBASE_ADMIN_CLIENT_EMAIL and/or FIREBASE_ADMIN_PRIVATE_KEY are not yet configured in .env.");
  console.log("To activate: Add service account values from Firebase Console -> Project Settings -> Service Accounts.");
}

process.exit(overallStatus === "READY" ? 0 : 1);
