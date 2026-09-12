/**
 * Server Authentication & Company Authorization Middleware
 * Verifies caller identity using Firebase Admin SDK.
 * NEVER trusts client-supplied UID or companyId without verification.
 */

import { getFirebaseAdmin } from "./firebaseAdmin";
import { MAX_SESSION_AGE_SECONDS } from "@/config/publicConfig";

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  companyId?: string;
  role?: string;
}

export interface AuthVerificationResult {
  success: boolean;
  user?: AuthenticatedUser;
  error?: string;
  code?: "UNAUTHORIZED" | "FORBIDDEN" | "SERVER_CONFIG_REQUIRED" | "SESSION_EXPIRED";
}

export function checkSessionAge(decodedToken: { auth_time?: number }): {
  valid: boolean;
  error?: string;
  code?: "SESSION_EXPIRED";
} {
  if (decodedToken.auth_time) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionAge = nowSeconds - decodedToken.auth_time;
    if (sessionAge > MAX_SESSION_AGE_SECONDS) {
      return {
        valid: false,
        error: "Your session expired. Sign in again to continue.",
        code: "SESSION_EXPIRED",
      };
    }
  }
  return { valid: true };
}

export async function verifyServerAuth(
  authHeader: string | null | undefined,
  requiredCompanyId?: string
): Promise<AuthVerificationResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials are not set.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return {
      success: false,
      error: "Missing or malformed Authorization header.",
      code: "UNAUTHORIZED",
    };
  }

  const token = authHeader.split("Bearer ")[1];

  try {
    const decoded = await adminApp.auth().verifyIdToken(token);
    const uid = decoded.uid;

    // Strict 2-Hour Session Expiration Check
    const sessionCheck = checkSessionAge(decoded);
    if (!sessionCheck.valid) {
      return {
        success: false,
        error: sessionCheck.error,
        code: sessionCheck.code,
      };
    }

    if (requiredCompanyId) {
      // Verify membership in database
      const db = adminApp.database();
      const memSnapshot = await db
        .ref(`memberships/${requiredCompanyId}/${uid}`)
        .once("value");

      if (!memSnapshot.exists()) {
        return {
          success: false,
          error: "You are not a member of this company.",
          code: "FORBIDDEN",
        };
      }

      const memData = memSnapshot.val();
      if (memData.status !== "active") {
        return {
          success: false,
          error: "Your membership in this company is inactive or suspended.",
          code: "FORBIDDEN",
        };
      }

      return {
        success: true,
        user: {
          uid,
          email: decoded.email,
          companyId: requiredCompanyId,
          role: memData.role,
        },
      };
    }

    return {
      success: true,
      user: {
        uid,
        email: decoded.email,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return {
      success: false,
      error: msg,
      code: "UNAUTHORIZED",
    };
  }
}
