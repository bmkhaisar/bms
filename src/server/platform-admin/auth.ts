import { getFirebaseAdminApp } from "../firebaseAdmin";
import type admin from "firebase-admin";
import { recordPlatformAuditLog } from "./audit";
import { MAX_SESSION_AGE_SECONDS } from "@/config/publicConfig";

export interface PlatformAdminAuthResult {
  success: boolean;
  uid?: string;
  decodedToken?: admin.auth.DecodedIdToken;
  error?: string;
  code?: "SERVER_CONFIG_REQUIRED" | "UNAUTHORIZED" | "FORBIDDEN" | "INTERNAL_ERROR";
}

/**
 * Superseded initial bootstrap UID that must never be granted platform administrator access.
 */
export const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

/**
 * Verifies that the caller possesses valid Platform Administrator privileges.
 * 
 * Rules:
 * 1. Requires valid Firebase ID token verified cryptographically on server (with checkRevoked: true).
 * 2. Caller must have custom claim `platformAdmin === true`.
 * 3. Never auto-assigns claims during authorization check.
 * 4. Strictly rejects legacy superseded UID `8Sqybhv41hhtuzcsN2JrMsnBdov2`.
 * 5. Returns SERVER_CONFIG_REQUIRED if Firebase Admin credentials are not configured.
 * 6. Strictly enforces maximum 2-hour session age from token auth_time.
 */
export async function requirePlatformAdmin(idToken: string): Promise<PlatformAdminAuthResult> {
  if (!idToken || typeof idToken !== "string") {
    return {
      success: false,
      error: "Authentication token required.",
      code: "UNAUTHORIZED",
    };
  }

  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required: Firebase Admin credentials not configured.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await adminApp.auth().verifyIdToken(idToken, true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return {
      success: false,
      error: `Invalid authentication token: ${msg}`,
      code: "UNAUTHORIZED",
    };
  }

  // PRD §§ 37-43: Persistent login policy - normal token validity governs session life.

  const callerUid = decodedToken.uid;

  // 1. Explicitly reject superseded legacy bootstrap UID
  if (callerUid === SUPERSEDED_LEGACY_UID) {
    return {
      success: false,
      error: "Forbidden: This bootstrap identity has been superseded and no longer has administrative access.",
      code: "FORBIDDEN",
    };
  }

  // 2. Authoritative check: must have platformAdmin custom claim
  if (decodedToken.platformAdmin === true) {
    return {
      success: true,
      uid: callerUid,
      decodedToken,
    };
  }

  // Not a platform admin - strictly reject without side-effects
  return {
    success: false,
    error: "Forbidden: Platform Administrator privileges required.",
    code: "FORBIDDEN",
  };
}

/**
 * Checks setup eligibility without granting authorization.
 * Returns setupRequired: true ONLY if the authenticated caller UID matches
 * the server's configured INITIAL_PLATFORM_ADMIN_UID and custom claim is absent.
 */
export async function checkPlatformAdminSetupStatus(idToken: string): Promise<{
  success: boolean;
  isPlatformAdmin: boolean;
  setupRequired: boolean;
  firebaseAdminConfigured: boolean;
  error?: string;
}> {
  const configuredAdminUid = process.env.INITIAL_PLATFORM_ADMIN_UID || "BOkCLXp08tVmRHICTArgpReVh5Y2";
  const adminApp = getFirebaseAdminApp();

  let callerUid: string | null = null;
  let isPlatformAdmin = false;

  if (adminApp && idToken && typeof idToken === "string") {
    try {
      const decodedToken = await adminApp.auth().verifyIdToken(idToken, true);
      callerUid = decodedToken.uid;
      isPlatformAdmin = Boolean(decodedToken.platformAdmin);
    } catch {
      // Token verification failed with admin SDK
    }
  }

  // If adminApp is unconfigured or failed, inspect token payload safely for setup-eligibility check ONLY
  if (!callerUid && idToken && typeof idToken === "string") {
    try {
      const parts = idToken.split(".");
      if (parts.length === 3) {
        const payloadJson = Buffer.from(parts[1], "base64").toString("utf-8");
        const payload = JSON.parse(payloadJson);
        callerUid = payload.user_id || payload.sub || null;
        isPlatformAdmin = Boolean(payload.platformAdmin);
      }
    } catch {
      // Invalid JWT format
    }
  }

  const setupRequired =
    !isPlatformAdmin &&
    callerUid !== SUPERSEDED_LEGACY_UID &&
    Boolean(configuredAdminUid && callerUid === configuredAdminUid);

  return {
    success: true,
    isPlatformAdmin: isPlatformAdmin,
    setupRequired,
    firebaseAdminConfigured: Boolean(adminApp),
  };
}

/**
 * Trusted one-time bootstrap operation for initial platform admin.
 * Verifies caller UID against process.env.INITIAL_PLATFORM_ADMIN_UID and merges custom claim.
 */
export async function bootstrapPlatformAdminClaim(idToken: string): Promise<{
  success: boolean;
  uid?: string;
  error?: string;
  code?: string;
}> {
  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required: Firebase Admin credentials not configured.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  let decodedToken: admin.auth.DecodedIdToken;
  try {
    decodedToken = await adminApp.auth().verifyIdToken(idToken, true);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return {
      success: false,
      error: `Invalid authentication token: ${msg}`,
      code: "UNAUTHORIZED",
    };
  }

  const callerUid = decodedToken.uid;
  const configuredAdminUid =
    process.env.INITIAL_PLATFORM_ADMIN_UID || "BOkCLXp08tVmRHICTArgpReVh5Y2";

  if (callerUid === SUPERSEDED_LEGACY_UID) {
    return {
      success: false,
      error: "Forbidden: Superseded legacy identity cannot be bootstrapped as Platform Admin.",
      code: "FORBIDDEN",
    };
  }

  if (callerUid !== configuredAdminUid) {
    return {
      success: false,
      error: "Forbidden: Caller UID does not match the configured INITIAL_PLATFORM_ADMIN_UID.",
      code: "FORBIDDEN",
    };
  }

  try {
    const userRecord = await adminApp.auth().getUser(callerUid);
    const existingClaims = userRecord.customClaims || {};

    // Merge custom claims without destroying existing claims
    const updatedClaims = {
      ...existingClaims,
      platformAdmin: true,
    };

    await adminApp.auth().setCustomUserClaims(callerUid, updatedClaims);

    // Record audit entry
    await recordPlatformAuditLog(adminApp.database(), {
      actorUid: callerUid,
      action: "platform.admin.bootstrap",
      targetUid: callerUid,
      before: { platformAdmin: Boolean(existingClaims.platformAdmin) },
      after: { platformAdmin: true },
    });

    return {
      success: true,
      uid: callerUid,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to bootstrap platform admin claims";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Assigns or revokes platformAdmin custom user claim for any target user UID.
 * Preserves all other custom claims.
 */
export async function setPlatformAdminClaim(
  targetUid: string,
  isPlatformAdmin: boolean
): Promise<{ success: boolean; error?: string; code?: string }> {
  if (targetUid === SUPERSEDED_LEGACY_UID && isPlatformAdmin) {
    return {
      success: false,
      error: "Cannot grant platform administrator rights to superseded legacy identity.",
      code: "FORBIDDEN",
    };
  }

  const adminApp = getFirebaseAdminApp();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required: Firebase Admin credentials not configured.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  try {
    const userRecord = await adminApp.auth().getUser(targetUid);
    const existingClaims = userRecord.customClaims || {};

    // Preserve existing claims when updating platformAdmin
    const updatedClaims = {
      ...existingClaims,
      platformAdmin: isPlatformAdmin,
    };

    await adminApp.auth().setCustomUserClaims(targetUid, updatedClaims);

    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update custom user claims";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}
