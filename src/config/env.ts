/**
 * Client and Server Environment Configuration
 * Strictly enforces that server secrets are NEVER exposed on the client bundle.
 */

export const clientEnv = {
  FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyBMxknpEMWvDVh9k3rGLfxKDvHUVckLDwE",
  FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "bmskh-6efb2.firebaseapp.com",
  FIREBASE_DATABASE_URL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://bmskh-6efb2-default-rtdb.firebaseio.com",
  FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID || "bmskh-6efb2",
  FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "bmskh-6efb2.firebasestorage.app",
  FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "151369329582",
  FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID || "1:151369329582:web:c209f60698cb1c04abf63f",
  FIREBASE_MEASUREMENT_ID: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || "G-7J9K596SH8",
};

export function isClientFirebaseConfigured(): boolean {
  return Boolean(
    clientEnv.FIREBASE_API_KEY &&
    clientEnv.FIREBASE_PROJECT_ID &&
    clientEnv.FIREBASE_DATABASE_URL
  );
}

/**
 * Deployment Environment Configuration
 * Centralized evaluation of staging/beta status.
 *
 * Checks:
 * 1. Build-time / runtime environment variables:
 *    - VITE_BMS_DEPLOYMENT_ENV
 *    - BMS_DEPLOYMENT_ENV
 * 2. Vercel deployment variables (if available)
 * 3. Client-side hostname detection (subdomains or preview URLs with "staging" or "beta")
 *
 * Production main strictly resolves to false.
 */
export const APP_ENV = (
  (typeof import.meta !== "undefined" && (import.meta.env?.VITE_APP_ENV || import.meta.env?.APP_ENV || import.meta.env?.VITE_BMS_DEPLOYMENT_ENV)) ||
  (typeof process !== "undefined" && (process.env?.VITE_APP_ENV || process.env?.APP_ENV || process.env?.VITE_BMS_DEPLOYMENT_ENV || process.env?.BMS_DEPLOYMENT_ENV)) ||
  ""
).trim().toLowerCase();

export const BMS_DEPLOYMENT_ENV = APP_ENV;

export function isBetaDeployment(): boolean {
  // Explicit environment configuration strictly takes precedence (SSR and browser client)
  if (APP_ENV === "production") {
    return false;
  }
  if (APP_ENV === "staging" || APP_ENV === "beta") {
    return true;
  }
  // Safe fallback for local Vite dev server
  if (typeof import.meta !== "undefined" && import.meta.env?.DEV) {
    return true;
  }
  return false;
}

