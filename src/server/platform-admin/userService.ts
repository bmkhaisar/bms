import { getFirebaseAdminApp } from "../firebaseAdmin";
import { requirePlatformAdmin } from "./auth";
import { recordPlatformAuditLog } from "./audit";

export interface CreateUserInput {
  idToken: string;
  email: string;
  displayName?: string;
  phoneNumber?: string;
  password?: string;
}

export interface PlatformUserSummary {
  uid: string;
  email: string;
  displayName: string;
  disabled: boolean;
  assignedCompaniesCount: number;
  assignedCompanyIds: string[];
  createdAt?: number;
}

/**
 * Searches for a user in Firebase Auth and RTDB by exact email.
 */
export async function findUserByEmail(idToken: string, email: string) {
  const authResult = await requirePlatformAdmin(idToken);
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const cleanEmail = email?.trim().toLowerCase();
  if (!cleanEmail) {
    return {
      success: false,
      error: "Email is required.",
      code: "INVALID_INPUT",
    };
  }

  const adminApp = getFirebaseAdminApp()!;
  try {
    const userRecord = await adminApp.auth().getUserByEmail(cleanEmail);
    return {
      success: true,
      found: true,
      user: {
        uid: userRecord.uid,
        email: userRecord.email || cleanEmail,
        displayName: userRecord.displayName || "",
        phoneNumber: userRecord.phoneNumber || "",
        disabled: userRecord.disabled,
        emailVerified: userRecord.emailVerified,
      },
    };
  } catch (err: any) {
    if (err.code === "auth/user-not-found") {
      return {
        success: true,
        found: false,
        user: null,
      };
    }
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to query user by email",
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Safe user creation workflow.
 * 1. Checks if user already exists via getUserByEmail().
 * 2. If user exists, returns existing UID without error.
 * 3. If user does not exist, creates the Firebase Auth account.
 * 4. Marks password invitation delivery as NOT_CONFIGURED (never faked).
 * 5. Does not log passwords or persist passwords in database.
 */
export async function createPlatformUser(input: CreateUserInput) {
  const authResult = await requirePlatformAdmin(input.idToken);
  if (!authResult.success || !authResult.uid) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const callerUid = authResult.uid;
  const cleanEmail = input.email?.trim().toLowerCase();
  if (!cleanEmail || !cleanEmail.includes("@")) {
    return {
      success: false,
      error: "A valid email address is required.",
      code: "INVALID_INPUT",
    };
  }

  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  // Step 1: Check if user already exists
  try {
    const existingRecord = await adminApp.auth().getUserByEmail(cleanEmail);
    // Ensure profile exists in RTDB users
    try {
      await db.ref(`users/${existingRecord.uid}`).update({
        uid: existingRecord.uid,
        email: existingRecord.email || cleanEmail,
        displayName: existingRecord.displayName || cleanEmail.split("@")[0],
        updatedAt: Date.now(),
      });
    } catch {
      // Non-fatal
    }

    return {
      success: true,
      existing: true,
      user: {
        uid: existingRecord.uid,
        email: existingRecord.email || cleanEmail,
        displayName: existingRecord.displayName || cleanEmail.split("@")[0],
      },
      PASSWORD_INVITATION_EMAIL: "NOT_CONFIGURED" as const,
      passwordInvitation: "NOT_CONFIGURED" as const,
      message: "User already exists in Firebase Authentication.",
    };
  } catch (err: any) {
    if (err.code !== "auth/user-not-found") {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Failed to verify email existence",
        code: "INTERNAL_ERROR",
      };
    }
  }

  // Step 2: Create new user in Firebase Auth
  const tempPassword =
    input.password && input.password.length >= 6
      ? input.password
      : `Bms!${Math.random().toString(36).substring(2, 8)}${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

  try {
    const userRecord = await adminApp.auth().createUser({
      email: cleanEmail,
      displayName: input.displayName?.trim() || cleanEmail.split("@")[0],
      phoneNumber: input.phoneNumber?.trim() || undefined,
      password: tempPassword,
    });

    const now = Date.now();
    const userProfile = {
      uid: userRecord.uid,
      email: cleanEmail,
      displayName: userRecord.displayName,
      createdAt: now,
      createdBy: callerUid,
    };

    await db.ref(`users/${userRecord.uid}`).set(userProfile);

    // Record audit event (without logging the password)
    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "platform.user.created",
      targetUid: userRecord.uid,
      after: {
        uid: userRecord.uid,
        email: cleanEmail,
        displayName: userProfile.displayName,
      },
    });

    return {
      success: true,
      existing: false,
      user: {
        uid: userRecord.uid,
        email: cleanEmail,
        displayName: userProfile.displayName,
        tempPasswordGenerated: !input.password,
        // Only return temp password to admin once for offline sharing
        tempPassword: input.password ? undefined : tempPassword,
      },
      PASSWORD_INVITATION_EMAIL: "NOT_CONFIGURED" as const,
      passwordInvitation: "NOT_CONFIGURED" as const,
    };
  } catch (err: any) {
    const msg = err instanceof Error ? err.message : "Failed to create user";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Lists all known users in the system and their company assignments with pagination support.
 * Queries Firebase Auth directory merged with RTDB user profiles and tenant indices.
 */
export async function listPlatformUsers(
  idToken: string,
  options?: { limit?: number; offset?: number }
) {
  const authResult = await requirePlatformAdmin(idToken);
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
      users: [],
    };
  }

  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  try {
    const [authUsersResult, usersSnap, userCompaniesSnap] = await Promise.all([
      adminApp.auth().listUsers(1000).catch(() => ({ users: [] })),
      db.ref("users").once("value"),
      db.ref("userCompanies").once("value"),
    ]);

    const usersVal = usersSnap.val() || {};
    const userCompaniesVal = userCompaniesSnap.val() || {};
    const userMap = new Map<string, PlatformUserSummary>();

    // 1. Process all Firebase Auth users (authoritative identities)
    for (const authUser of authUsersResult.users) {
      const rtdbData = usersVal[authUser.uid] || {};
      const assignedCompanies = Object.keys(userCompaniesVal[authUser.uid] || {});
      const createdTime =
        rtdbData.createdAt ||
        (authUser.metadata?.creationTime ? new Date(authUser.metadata.creationTime).getTime() : 0);

      userMap.set(authUser.uid, {
        uid: authUser.uid,
        email: authUser.email || rtdbData.email || "",
        displayName:
          authUser.displayName ||
          rtdbData.displayName ||
          (authUser.email ? authUser.email.split("@")[0] : "User"),
        disabled: Boolean(authUser.disabled),
        assignedCompaniesCount: assignedCompanies.length,
        assignedCompanyIds: assignedCompanies,
        createdAt: createdTime,
      });
    }

    // 2. Include any RTDB users not yet returned in auth list
    for (const [uid, uData] of Object.entries<any>(usersVal)) {
      if (!userMap.has(uid)) {
        const assignedCompanies = Object.keys(userCompaniesVal[uid] || {});
        userMap.set(uid, {
          uid,
          email: uData.email || "",
          displayName: uData.displayName || "Unknown",
          disabled: false,
          assignedCompaniesCount: assignedCompanies.length,
          assignedCompanyIds: assignedCompanies,
          createdAt: uData.createdAt || 0,
        });
      }
    }

    const summaries = Array.from(userMap.values());

    // Sort descending by creation
    summaries.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    const limit = options?.limit || 100;
    const offset = options?.offset || 0;
    const paginated = summaries.slice(offset, offset + limit);

    return {
      success: true,
      total: summaries.length,
      users: paginated,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list platform users";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
      users: [],
    };
  }
}
