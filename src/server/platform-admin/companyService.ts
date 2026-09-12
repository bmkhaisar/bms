import { getFirebaseAdminApp } from "../firebaseAdmin";
import { requirePlatformAdmin } from "./auth";
import { recordPlatformAuditLog } from "./audit";
import { ensureChartOfAccounts } from "../accounting/initChartOfAccounts";

export interface CreateCompanyInput {
  idToken: string;
  name: string;
  legalName?: string;
  tradingName?: string;
  gstin?: string;
  pan?: string;
  cin?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  country?: string;
  stateCode?: string;
  currency?: string;
  currencySymbol?: string;
  timezone?: string;
  initialOwnerUid?: string;
  initialOwnerEmail?: string;
  fyName: string;
  fyStart: number;
  fyEnd: number;
}

export interface PlatformCompanySummary {
  id: string;
  name: string;
  legalName?: string;
  gstin?: string;
  active: boolean;
  createdAt: number;
  createdBy: string;
  ownerUid?: string;
  ownerEmail?: string;
  activeUsersCount: number;
}

/**
 * Creates a company as Platform Admin.
 * Supports assigning an optional initial owner.
 * Does NOT require Platform Admin to become a company member.
 */
export async function createCompanyAsPlatformAdmin(input: CreateCompanyInput) {
  const authResult = await requirePlatformAdmin(input.idToken);
  if (!authResult.success || !authResult.uid) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
    };
  }

  const callerUid = authResult.uid;
  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  if (!input.name || !input.name.trim()) {
    return {
      success: false,
      error: "Company name is required.",
      code: "INVALID_INPUT",
    };
  }

  if (!input.fyName || !input.fyStart || !input.fyEnd || input.fyStart >= input.fyEnd) {
    return {
      success: false,
      error: "Valid financial year period (name, start date, end date) is required.",
      code: "INVALID_INPUT",
    };
  }

  // If initial owner is specified (via email or UID), verify it exists in Firebase Auth
  let verifiedOwnerUid: string | null = null;
  let verifiedOwnerEmail: string = "";
  if (input.initialOwnerEmail && input.initialOwnerEmail.trim()) {
    try {
      const userRecord = await adminApp.auth().getUserByEmail(input.initialOwnerEmail.trim().toLowerCase());
      verifiedOwnerUid = userRecord.uid;
      verifiedOwnerEmail = userRecord.email || input.initialOwnerEmail.trim();
    } catch {
      return {
        success: false,
        error: `Target owner email '${input.initialOwnerEmail}' does not exist in Firebase Authentication.`,
        code: "USER_NOT_FOUND",
      };
    }
  } else if (input.initialOwnerUid && input.initialOwnerUid.trim()) {
    try {
      const userRecord = await adminApp.auth().getUser(input.initialOwnerUid.trim());
      verifiedOwnerUid = userRecord.uid;
      verifiedOwnerEmail = userRecord.email || "";
    } catch {
      return {
        success: false,
        error: `Target owner UID '${input.initialOwnerUid}' does not exist in Firebase Authentication.`,
        code: "USER_NOT_FOUND",
      };
    }
  }

  const now = Date.now();
  const companyId = `comp_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const fyId = `fy_${now}_${Math.random().toString(36).substring(2, 6)}`;

  const companyRecord = {
    id: companyId,
    name: input.name.trim(),
    legalName: input.legalName?.trim() || input.name.trim(),
    tradingName: input.tradingName?.trim() || "",
    gstin: input.gstin?.trim() || "",
    pan: input.pan?.trim() || "",
    cin: input.cin?.trim() || "",
    email: input.email?.trim() || "",
    phone: input.phone?.trim() || "",
    address: input.address?.trim() || "",
    city: input.city?.trim() || "",
    state: input.state?.trim() || "",
    pincode: input.pincode?.trim() || "",
    country: input.country?.trim() || "India",
    stateCode: input.stateCode?.trim() || "",
    currency: input.currency?.trim() || "INR",
    currencySymbol: input.currencySymbol?.trim() || "₹",
    timezone: input.timezone?.trim() || "Asia/Kolkata",
    createdAt: now,
    createdBy: callerUid,
    active: true,
  };

  const branchRecord = {
    id: "br_main",
    companyId,
    name: "Main Branch",
    code: "MAIN",
    isHeadOffice: true,
    active: true,
    createdAt: now,
    createdBy: callerUid,
  };

  const fyRecord = {
    id: fyId,
    companyId,
    name: input.fyName.trim(),
    startDate: input.fyStart,
    endDate: input.fyEnd,
    locked: false,
    isCurrent: true,
    createdAt: now,
    createdBy: callerUid,
  };

  const updates: Record<string, any> = {};
  updates[`companies/${companyId}`] = companyRecord;
  updates[`companyData/${companyId}/branches/br_main`] = branchRecord;
  updates[`companyData/${companyId}/financialYears/${fyId}`] = fyRecord;

  // Lightweight summary for fast listing and counters
  updates[`companySummaries/${companyId}`] = {
    companyId,
    name: companyRecord.name,
    activeMemberCount: verifiedOwnerUid ? 1 : 0,
    ownerCount: verifiedOwnerUid ? 1 : 0,
    status: "active",
    updatedAt: now,
  };

  // If initial owner assigned:
  if (verifiedOwnerUid) {
    const membershipRecord = {
      uid: verifiedOwnerUid,
      role: "owner",
      roleId: "owner",
      status: "active",
      branchIds: { br_main: true },
      customPermissions: [],
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
    };
    updates[`memberships/${companyId}/${verifiedOwnerUid}`] = membershipRecord;
    updates[`userCompanies/${verifiedOwnerUid}/${companyId}`] = true;
    updates[`users/${verifiedOwnerUid}/uid`] = verifiedOwnerUid;
    updates[`users/${verifiedOwnerUid}/email`] = verifiedOwnerEmail;
    updates[`users/${verifiedOwnerUid}/updatedAt`] = now;
  }

  try {
    await db.ref().update(updates);

    // Initialize Chart of Accounts automatically
    await ensureChartOfAccounts(companyId);

    // Record Platform Audit
    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "company.created",
      companyId,
      targetUid: verifiedOwnerUid || undefined,
      after: {
        companyId,
        name: companyRecord.name,
        initialOwnerUid: verifiedOwnerUid,
        initialOwnerEmail: verifiedOwnerEmail,
      },
    });

    return {
      success: true,
      companyId,
      company: companyRecord,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create company";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Lists registered companies with metadata, member counts, and optional pagination.
 * Utilizes /companySummaries when available to avoid querying entire membership trees.
 */
export async function listCompaniesAsPlatformAdmin(
  idToken: string,
  options?: { limit?: number; offset?: number }
) {
  const authResult = await requirePlatformAdmin(idToken);
  if (!authResult.success) {
    return {
      success: false,
      error: authResult.error || "Unauthorized",
      code: authResult.code || "UNAUTHORIZED",
      companies: [],
      totalCount: 0,
    };
  }

  const adminApp = getFirebaseAdminApp()!;
  const db = adminApp.database();

  try {
    const [companiesSnap, summariesSnap, membershipsSnap] = await Promise.all([
      db.ref("companies").once("value"),
      db.ref("companySummaries").once("value"),
      db.ref("memberships").once("value"),
    ]);

    const companiesVal = companiesSnap.val() || {};
    const summariesVal = summariesSnap.val() || {};
    const membershipsVal = membershipsSnap.val() || {};

    const list: PlatformCompanySummary[] = [];

    for (const [compId, compData] of Object.entries<any>(companiesVal)) {
      const summary = summariesVal[compId];
      const compMemberships = membershipsVal[compId] || {};

      let activeUsersCount = summary?.activeMemberCount;
      let ownerUid: string | undefined;

      // If summary is not precalculated or owner needs finding:
      if (activeUsersCount === undefined) {
        activeUsersCount = 0;
        for (const [mUid, mData] of Object.entries<any>(compMemberships)) {
          if (mData?.status === "active") {
            activeUsersCount++;
          }
          if (mData?.role === "owner" || mData?.roleId === "owner") {
            ownerUid = mUid;
          }
        }
      } else {
        for (const [mUid, mData] of Object.entries<any>(compMemberships)) {
          if (mData?.role === "owner" || mData?.roleId === "owner") {
            ownerUid = mUid;
            break;
          }
        }
      }

      list.push({
        id: compId,
        name: compData.name || "Unnamed Company",
        legalName: compData.legalName,
        gstin: compData.gstin,
        active: compData.active !== false,
        createdAt: compData.createdAt || 0,
        createdBy: compData.createdBy || "",
        ownerUid,
        activeUsersCount: activeUsersCount || 0,
      });
    }

    // Sort descending by creation date
    list.sort((a, b) => b.createdAt - a.createdAt);

    const totalCount = list.length;
    let paginated = list;
    if (options && options.limit !== undefined) {
      const offset = options.offset || 0;
      paginated = list.slice(offset, offset + options.limit);
    }

    return {
      success: true,
      companies: paginated,
      totalCount,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list companies";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
      companies: [],
      totalCount: 0,
    };
  }
}
