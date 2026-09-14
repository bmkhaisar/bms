/**
 * Authoritative Server Environment Module
 * 
 * STRICTLY SERVER ONLY.
 * Never import this file from client-side code or React components.
 * 
 * Normalizes, validates, and diagnoses server environment configuration:
 * - Firebase Admin SDK credentials
 * - Realtime Database URL
 * - Cloudflare R2 Storage credentials
 * - Platform Administrator bootstrap parameters
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// 1. Guard against accidental client-side bundling/execution
if (typeof window !== "undefined") {
  throw new Error("SECURITY VIOLATION: serverEnv.ts must never be imported or executed on the client.");
}

// 2. Safe local .env loader for TanStack Start / Vite / Nitro server runtime
let envLoaded = false;

export function ensureServerEnvLoaded(customPath?: string): void {
  if (envLoaded && !customPath) return;

  try {
    const targetPath = customPath || resolve(process.cwd(), ".env");
    if (existsSync(targetPath)) {
      const content = readFileSync(targetPath, "utf8");
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx !== -1) {
          const rawKey = trimmed.substring(0, eqIdx).trim();
          let rawVal = trimmed.substring(eqIdx + 1).trim();
          // Strip wrapping quotes if present
          if (
            (rawVal.startsWith('"') && rawVal.endsWith('"')) ||
            (rawVal.startsWith("'") && rawVal.endsWith("'"))
          ) {
            rawVal = rawVal.substring(1, rawVal.length - 1);
          }
          // Set in process.env if not already defined (or if custom path passed)
          if (process.env[rawKey] === undefined || customPath) {
            process.env[rawKey] = rawVal;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Notice: Failed to read local .env file in server runtime:", err);
  } finally {
    envLoaded = true;
  }
}

// Auto-load on initial module evaluation
ensureServerEnvLoaded();

// 3. Status Codes & Types
export type FirebaseAdminStatus =
  | "FIREBASE_ADMIN_READY"
  | "FIREBASE_ADMIN_NOT_CONFIGURED"
  | "FIREBASE_ADMIN_INVALID_PRIVATE_KEY"
  | "FIREBASE_ADMIN_INVALID_CLIENT_EMAIL"
  | "FIREBASE_DATABASE_URL_MISSING"
  | "FIREBASE_ADMIN_PROJECT_MISMATCH"
  | "FIREBASE_ADMIN_INITIALIZATION_FAILED";

export interface FirebaseAdminDiagnostic {
  configured: boolean;
  validShape: boolean;
  status: FirebaseAdminStatus;
  statusMessage: string;
  missingVariables: string[];
  projectIdPresent: boolean;
  clientEmailPresent: boolean;
  privateKeyPresent: boolean;
  databaseUrlPresent: boolean;
}

export interface R2Diagnostic {
  configured: boolean;
  missingVariables: string[];
}

export interface PlatformAdminDiagnostic {
  initialUidConfigured: boolean;
  initialEmailConfigured: boolean;
  configuredUid: string | null;
}

export interface ServerEnvDiagnostic {
  firebaseAdmin: FirebaseAdminDiagnostic;
  r2: R2Diagnostic;
  platformAdmin: PlatformAdminDiagnostic;
}

export interface NormalizedFirebaseAdminConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
  databaseURL: string;
}

/** Remove whitespace and one accidental matching pair of outer quotes from scalar env values. */
export function normalizeEnvScalar(rawValue: string | undefined): string {
  if (!rawValue || typeof rawValue !== "string") return "";
  let value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.substring(1, value.length - 1).trim();
  }
  return value;
}

// 4. Private Key Normalization & Validation Helper
export function normalizePrivateKey(rawKey: string | undefined): {
  normalized: string | null;
  isValid: boolean;
} {
  if (!rawKey || typeof rawKey !== "string") {
    return { normalized: null, isValid: false };
  }

  let key = normalizeEnvScalar(rawKey);

  // Replace escaped \n line breaks with real newlines
  if (key.includes("\\n")) {
    key = key.replace(/\\n/g, "\n");
  }

  // Validate PEM headers
  const hasBegin = key.includes("-----BEGIN PRIVATE KEY-----");
  const hasEnd = key.includes("-----END PRIVATE KEY-----");

  if (!hasBegin || !hasEnd) {
    return { normalized: key, isValid: false };
  }

  return { normalized: key, isValid: true };
}

// 5. Authoritative Diagnostic Evaluator
export function evaluateServerEnv(envSource: Record<string, string | undefined> = process.env): ServerEnvDiagnostic {
  const projectId = normalizeEnvScalar(envSource.FIREBASE_ADMIN_PROJECT_ID);
  const clientProjectId = normalizeEnvScalar(envSource.VITE_FIREBASE_PROJECT_ID);
  const clientEmail = normalizeEnvScalar(envSource.FIREBASE_ADMIN_CLIENT_EMAIL);
  const rawPrivateKey = (envSource.FIREBASE_ADMIN_PRIVATE_KEY || "").trim();
  const databaseURL = normalizeEnvScalar(envSource.FIREBASE_DATABASE_URL || envSource.VITE_FIREBASE_DATABASE_URL);

  const missingVariables: string[] = [];
  if (!projectId) missingVariables.push("FIREBASE_ADMIN_PROJECT_ID");
  if (!clientEmail) missingVariables.push("FIREBASE_ADMIN_CLIENT_EMAIL");
  if (!rawPrivateKey) missingVariables.push("FIREBASE_ADMIN_PRIVATE_KEY");
  if (!databaseURL) missingVariables.push("FIREBASE_DATABASE_URL");

  const projectIdPresent = Boolean(projectId);
  const clientEmailPresent = Boolean(clientEmail);
  const privateKeyPresent = Boolean(rawPrivateKey);
  const databaseUrlPresent = Boolean(databaseURL);

  let status: FirebaseAdminStatus = "FIREBASE_ADMIN_NOT_CONFIGURED";
  let statusMessage = "Server administration is not configured yet. Company and user provisioning is temporarily unavailable.";
  let validShape = false;

  if (!projectIdPresent || !clientEmailPresent || !privateKeyPresent) {
    status = "FIREBASE_ADMIN_NOT_CONFIGURED";
    statusMessage = `Server administration is not configured yet. Missing required environment variables: ${missingVariables.join(", ")}.`;
  } else if (!databaseUrlPresent) {
    status = "FIREBASE_DATABASE_URL_MISSING";
    statusMessage = "Realtime Database server configuration is incomplete (FIREBASE_DATABASE_URL missing).";
  } else if (clientProjectId && projectId !== clientProjectId) {
    status = "FIREBASE_ADMIN_PROJECT_MISMATCH";
    statusMessage = `Firebase Admin project mismatch: service account (${projectId}) does not match client project (${clientProjectId}).`;
  } else if (!clientEmail.includes("@") || !clientEmail.includes(".")) {
    status = "FIREBASE_ADMIN_INVALID_CLIENT_EMAIL";
    statusMessage = "Firebase Admin service account client email format is invalid.";
  } else {
    const { isValid } = normalizePrivateKey(rawPrivateKey);
    if (!isValid) {
      status = "FIREBASE_ADMIN_INVALID_PRIVATE_KEY";
      statusMessage = "Firebase Admin private-key format is invalid. Ensure BEGIN and END PRIVATE KEY markers are intact.";
    } else if (!clientEmail.toLowerCase().endsWith(`@${projectId.toLowerCase()}.iam.gserviceaccount.com`)) {
      status = "FIREBASE_ADMIN_PROJECT_MISMATCH";
      statusMessage = "Firebase Admin client email does not belong to the configured Admin project.";
    } else {
      validShape = true;
      status = "FIREBASE_ADMIN_READY";
      statusMessage = "Firebase Admin configuration verified and ready.";
    }
  }

  // R2 Diagnostic
  const r2Missing: string[] = [];
  if (!envSource.R2_ACCOUNT_ID) r2Missing.push("R2_ACCOUNT_ID");
  if (!envSource.R2_ACCESS_KEY_ID) r2Missing.push("R2_ACCESS_KEY_ID");
  if (!envSource.R2_SECRET_ACCESS_KEY) r2Missing.push("R2_SECRET_ACCESS_KEY");
  if (!envSource.R2_BUCKET_NAME) r2Missing.push("R2_BUCKET_NAME");

  const r2Configured = r2Missing.length === 0;

  // Platform Admin Diagnostic
  const configuredUid = envSource.INITIAL_PLATFORM_ADMIN_UID || null;
  const initialUidConfigured = Boolean(configuredUid);
  const initialEmailConfigured = Boolean(envSource.INITIAL_PLATFORM_ADMIN_EMAIL);

  return {
    firebaseAdmin: {
      configured: status === "FIREBASE_ADMIN_READY",
      validShape,
      status,
      statusMessage,
      missingVariables,
      projectIdPresent,
      clientEmailPresent,
      privateKeyPresent,
      databaseUrlPresent,
    },
    r2: {
      configured: r2Configured,
      missingVariables: r2Missing,
    },
    platformAdmin: {
      initialUidConfigured,
      initialEmailConfigured,
      configuredUid,
    },
  };
}

// 6. Safe Getter for Normalized Admin Configuration (Throws or returns null)
export function getValidatedFirebaseAdminConfig(
  envSource: Record<string, string | undefined> = process.env
): NormalizedFirebaseAdminConfig | null {
  const diagnostic = evaluateServerEnv(envSource);
  if (!diagnostic.firebaseAdmin.validShape) {
    return null;
  }

  const rawKey = envSource.FIREBASE_ADMIN_PRIVATE_KEY || "";
  const { normalized } = normalizePrivateKey(rawKey);
  if (!normalized) return null;

  const projectId = normalizeEnvScalar(envSource.FIREBASE_ADMIN_PROJECT_ID);
  const clientEmail = normalizeEnvScalar(envSource.FIREBASE_ADMIN_CLIENT_EMAIL);
  const databaseURL = normalizeEnvScalar(envSource.FIREBASE_DATABASE_URL || envSource.VITE_FIREBASE_DATABASE_URL);

  return {
    projectId,
    clientEmail,
    privateKey: normalized,
    databaseURL,
  };
}
