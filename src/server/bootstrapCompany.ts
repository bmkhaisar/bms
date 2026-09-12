import { getFirebaseAdmin } from "./firebaseAdmin";
import { ensureCompanyChartOfAccounts } from "./accounting/initChartOfAccounts";

export interface BootstrapCompanyInput {
  idToken: string;
  name: string;
  legalName?: string;
  tradingName?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  email?: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  country?: string;
  stateCode?: string;
  currency?: string;
  currencySymbol?: string;
  timezone?: string;
  fyName: string;
  fyStart: number;
  fyEnd: number;
}

export interface BootstrapCompanyResult {
  success: boolean;
  companyId?: string;
  alreadyBootstrapped?: boolean;
  error?: string;
  code?:
    | "SERVER_CONFIG_REQUIRED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "INVALID_INPUT"
    | "ALREADY_BOOTSTRAPPED"
    | "INTERNAL_ERROR";
}

/**
 * Trusted server operation to bootstrap the first company.
 * 
 * Enforces:
 * 1. Strict UID-based verification (only INITIAL_OWNER_UID).
 * 2. Idempotency: concurrent or duplicate requests return the existing company (ALREADY_BOOTSTRAPPED).
 * 3. Dynamic financial year validation (name, start, end).
 * 4. Authoritative decoded token data for user identity (ignores client-supplied email for user profile).
 * 5. Structured membership with future custom permissions support.
 */
export async function executeBootstrapCompany(
  input: BootstrapCompanyInput
): Promise<BootstrapCompanyResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials must be configured on the server to execute trusted bootstrap operations.",
      code: "SERVER_CONFIG_REQUIRED",
    };
  }

  if (!input.idToken) {
    return {
      success: false,
      error: "Authentication token required.",
      code: "UNAUTHORIZED",
    };
  }

  if (!input.name?.trim() || !input.phone?.trim() || !input.address?.trim()) {
    return {
      success: false,
      error: "Company Name, Phone, and Address are required.",
      code: "INVALID_INPUT",
    };
  }

  // Validate dynamic Financial Year parameters
  if (!input.fyName?.trim()) {
    return {
      success: false,
      error: "Financial Year name is required.",
      code: "INVALID_INPUT",
    };
  }
  if (
    typeof input.fyStart !== "number" ||
    typeof input.fyEnd !== "number" ||
    isNaN(input.fyStart) ||
    isNaN(input.fyEnd)
  ) {
    return {
      success: false,
      error: "Financial Year start date and end date must be valid epoch timestamps.",
      code: "INVALID_INPUT",
    };
  }
  if (input.fyStart >= input.fyEnd) {
    return {
      success: false,
      error: "Financial Year start date must precede the end date.",
      code: "INVALID_INPUT",
    };
  }
  if (input.fyEnd - input.fyStart < 86400000) {
    return {
      success: false,
      error: "Financial Year duration must span at least 1 day.",
      code: "INVALID_INPUT",
    };
  }

  // 1. Verify caller ID token
  let decodedToken;
  try {
    decodedToken = await adminApp.auth().verifyIdToken(input.idToken);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Token verification failed";
    return {
      success: false,
      error: `Invalid authentication token: ${msg}`,
      code: "UNAUTHORIZED",
    };
  }

  const callerUid = decodedToken.uid;
  const configuredAdminUid = process.env.INITIAL_PLATFORM_ADMIN_UID || process.env.INITIAL_OWNER_UID;

  // Explicit rejection of superseded bootstrap identity
  if (callerUid === "8Sqybhv41hhtuzcsN2JrMsnBdov2") {
    return {
      success: false,
      error: "Forbidden: This bootstrap identity has been superseded and no longer has administrative access.",
      code: "FORBIDDEN",
    };
  }

  // 2. Strict platform admin check (UID based, not email based)
  if (!configuredAdminUid || callerUid !== configuredAdminUid) {
    return {
      success: false,
      error: "Forbidden: You are not authorized to bootstrap initial company ownership. Only the configured platform admin UID is authorized.",
      code: "FORBIDDEN",
    };
  }

  const db = adminApp.database();
  const now = Date.now();

  // 3. Idempotency Check: Verify if user already has an existing company
  try {
    const existingUserCompaniesSnap = await db
      .ref(`userCompanies/${callerUid}`)
      .once("value");

    if (existingUserCompaniesSnap.exists()) {
      const companies = existingUserCompaniesSnap.val();
      const existingCompanyId = Object.keys(companies || {})[0];
      if (existingCompanyId) {
        return {
          success: true,
          companyId: existingCompanyId,
          alreadyBootstrapped: true,
          code: "ALREADY_BOOTSTRAPPED",
        };
      }
    }
  } catch (err: unknown) {
    console.warn("Could not check existing user companies:", err);
  }

  // 4. Server-side concurrency lock using atomic transaction
  const lockRef = db.ref(`bootstrapLocks/${callerUid}`);
  try {
    const lockTx = await lockRef.transaction((current) => {
      if (current && (current.status === "completed" || current.status === "locked")) {
        return; // Abort transaction if already locked or completed
      }
      return {
        status: "locked",
        lockedAt: now,
      };
    });

    if (!lockTx.committed) {
      // Another concurrent bootstrap request won the race or already finished
      const recheckSnap = await db.ref(`userCompanies/${callerUid}`).once("value");
      if (recheckSnap.exists()) {
        const existingId = Object.keys(recheckSnap.val() || {})[0];
        if (existingId) {
          return {
            success: true,
            companyId: existingId,
            alreadyBootstrapped: true,
            code: "ALREADY_BOOTSTRAPPED",
          };
        }
      }
      return {
        success: false,
        error: "A company bootstrap operation is currently in progress. Please wait a moment.",
        code: "ALREADY_BOOTSTRAPPED",
      };
    }
  } catch (lockErr) {
    console.warn("Bootstrap lock transaction warning:", lockErr);
  }

  const companyId = `comp_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const fyId = `fy_${now}`;
  const branchId = `br_main`;
  const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

  // 5. Prepare atomic multi-path update in Firebase Realtime Database
  const updates: Record<string, unknown> = {};

  // Authoritative user profile metadata from decoded token
  updates[`users/${callerUid}`] = {
    uid: callerUid,
    email: decodedToken.email || "",
    displayName: decodedToken.name || decodedToken.email?.split("@")[0] || "Authorized Owner",
    active: true,
    createdAt: now,
    updatedAt: now,
  };

  // Company profile
  updates[`companies/${companyId}`] = {
    id: companyId,
    name: input.name.trim(),
    legalName: (input.legalName || input.name).trim(),
    tradingName: input.tradingName || "",
    gstin: (input.gstin || "").toUpperCase(),
    pan: (input.pan || "").toUpperCase(),
    cin: (input.cin || "").toUpperCase(),
    email: (input.email || decodedToken.email || "").trim(),
    phone: input.phone.trim(),
    address: input.address.trim(),
    city: input.city.trim(),
    state: input.state.trim(),
    pincode: input.pincode.trim(),
    country: input.country || "India",
    stateCode: input.stateCode || "",
    currency: input.currency || "INR",
    currencySymbol: input.currencySymbol || "₹",
    timezone: input.timezone || "Asia/Kolkata",
    currentFinancialYearId: fyId,
    createdAt: now,
    createdBy: callerUid,
  };

  // Owner membership (role: owner, status: active, future customPermissions array)
  updates[`memberships/${companyId}/${callerUid}`] = {
    uid: callerUid,
    companyId,
    role: "owner",
    status: "active",
    customPermissions: [],
    createdAt: now,
    createdBy: callerUid,
  };

  // User companies reverse lookup index
  updates[`userCompanies/${callerUid}/${companyId}`] = true;

  // Dynamic Financial Year (validated from client form)
  updates[`companyData/${companyId}/financialYears/${fyId}`] = {
    id: fyId,
    name: input.fyName.trim(),
    startDate: input.fyStart,
    endDate: input.fyEnd,
    locked: false,
    createdAt: now,
  };

  // Default Main Branch
  updates[`companyData/${companyId}/branches/${branchId}`] = {
    id: branchId,
    name: "Main Branch",
    code: "MAIN",
    active: true,
    createdAt: now,
  };

  // Audit trail record
  updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "company",
    entityId: companyId,
    action: "bootstrap",
    performedBy: callerUid,
    timestamp: now,
    newState: {
      companyName: input.name,
      ownerUid: callerUid,
      financialYear: input.fyName.trim(),
    },
  };

  // Mark bootstrap lock completed with companyId
  updates[`bootstrapLocks/${callerUid}`] = {
    status: "completed",
    companyId,
    bootstrappedAt: now,
  };

  // Seed default Chart of Accounts and foundational ledgers atomically
  await ensureCompanyChartOfAccounts(db, companyId, callerUid, now, updates);

  try {
    await db.ref().update(updates);
    return {
      success: true,
      companyId,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Database write failed";
    console.error("Failed to commit company bootstrap updates:", err);
    // Release the lock on failure so user can retry
    try {
      await db.ref(`bootstrapLocks/${callerUid}`).remove();
    } catch {
      // ignore
    }
    return {
      success: false,
      error: `Failed to commit company bootstrap: ${msg}`,
      code: "INTERNAL_ERROR",
    };
  }
}
