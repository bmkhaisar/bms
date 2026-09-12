/**
 * Server-only Firebase Admin SDK Initialization
 * Strictly executed on server endpoints / Nitro server functions.
 * NEVER import this file from client-side code or React components.
 */

import admin from "firebase-admin";
import {
  evaluateServerEnv,
  getValidatedFirebaseAdminConfig,
  type FirebaseAdminStatus,
} from "./config/serverEnv.ts";

export interface ServerConfigStatus {
  isConfigured: boolean;
  projectId?: string;
  clientEmail?: string;
}

export interface PlatformServerStatus {
  firebaseAdminConfigured: boolean;
  firebaseAdminReady: boolean;
  status: FirebaseAdminStatus;
  statusMessage: string;
  missingVariables: string[];
  platformAdminClaimConfigured: boolean;
  r2Configured: boolean;
}

let adminApp: admin.app.App | null = null;

/**
 * Returns the singleton Firebase Admin App instance.
 * Safe across TanStack Start, Nitro, Vercel serverless, and development HMR.
 */
export function getFirebaseAdmin(): admin.app.App | null {
  if (adminApp) return adminApp;

  // Singleton app reuse check
  if (admin.apps.length > 0 && admin.apps[0]) {
    adminApp = admin.apps[0];
    return adminApp;
  }

  const config = getValidatedFirebaseAdminConfig();
  if (!config) {
    return null;
  }

  try {
    adminApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: config.projectId,
        clientEmail: config.clientEmail,
        privateKey: config.privateKey,
      }),
      databaseURL: config.databaseURL,
    });
    return adminApp;
  } catch (error) {
    console.error("Failed to initialize Firebase Admin SDK:", error);
    return null;
  }
}

export const getFirebaseAdminApp = getFirebaseAdmin;

/**
 * Reset singleton app reference (for testing only)
 */
export function _resetAdminAppForTesting(): void {
  adminApp = null;
}

export function getServerConfigStatus(): ServerConfigStatus {
  const app = getFirebaseAdmin();
  const config = getValidatedFirebaseAdminConfig();
  return {
    isConfigured: app !== null,
    projectId: config?.projectId || process.env.FIREBASE_ADMIN_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
    clientEmail: config?.clientEmail || process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
  };
}

/**
 * Returns safe boolean-only and diagnostic system configuration status.
 * Never returns private keys, secrets, or credential strings.
 */
export function getPlatformServerStatus(): PlatformServerStatus {
  const diagnostic = evaluateServerEnv();
  const app = getFirebaseAdmin();

  const isReady = app !== null;

  return {
    firebaseAdminConfigured: isReady,
    firebaseAdminReady: isReady,
    status: isReady ? "FIREBASE_ADMIN_READY" : diagnostic.firebaseAdmin.status,
    statusMessage: isReady ? "Firebase Admin SDK is active and connected." : diagnostic.firebaseAdmin.statusMessage,
    missingVariables: diagnostic.firebaseAdmin.missingVariables,
    platformAdminClaimConfigured: diagnostic.platformAdmin.initialUidConfigured,
    r2Configured: diagnostic.r2.configured,
  };
}
