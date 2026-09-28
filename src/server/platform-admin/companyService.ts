import { getFirebaseAdminApp } from "../firebaseAdmin";
import { requirePlatformAdmin } from "./auth";
import { recordPlatformAuditLog } from "./audit";
import { ensureChartOfAccounts } from "../accounting/initChartOfAccounts";

/**
 * Recursively removes all properties with `undefined` values from an object,
 * preventing Firebase Realtime Database "values argument contains undefined" errors.
 */
function cleanUndefinedDeep<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(cleanUndefinedDeep) as unknown as T;
  }
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (val !== undefined) {
      result[key] = cleanUndefinedDeep(val);
    }
  }
  return result as T;
}

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
  organizationType?: "NORMAL" | "DEMO";
  isDemo?: boolean;
  demoExpiresAt?: number;
  demoDescription?: string;
  internalNote?: string;
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
  organizationType: "NORMAL" | "DEMO";
  isDemo: boolean;
  demoExpiresAt?: number;
  demoDescription?: string;
  internalNote?: string;
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

  const isDemo = input.organizationType === "DEMO" || Boolean(input.isDemo);
  const organizationType: "NORMAL" | "DEMO" = isDemo ? "DEMO" : "NORMAL";

  const companyRecord: Record<string, any> = {
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
    organizationType,
    isDemo,
  };

  if (isDemo && input.demoExpiresAt) {
    companyRecord.demoExpiresAt = input.demoExpiresAt;
  }
  if (isDemo && input.demoDescription?.trim()) {
    companyRecord.demoDescription = input.demoDescription.trim();
  }
  if (input.internalNote?.trim()) {
    companyRecord.internalNote = input.internalNote.trim();
  }

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
  const summaryRecord: Record<string, any> = {
    companyId,
    name: companyRecord.name,
    activeMemberCount: verifiedOwnerUid ? 1 : 0,
    ownerCount: verifiedOwnerUid ? 1 : 0,
    status: "active",
    organizationType,
    isDemo,
    updatedAt: now,
  };
  if (isDemo && input.demoExpiresAt) {
    summaryRecord.demoExpiresAt = input.demoExpiresAt;
  }
  if (isDemo && input.demoDescription?.trim()) {
    summaryRecord.demoDescription = input.demoDescription.trim();
  }
  updates[`companySummaries/${companyId}`] = summaryRecord;

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
    await db.ref().update(cleanUndefinedDeep(updates));

    // Initialize Chart of Accounts automatically
    await ensureChartOfAccounts(companyId);

    // Record Platform Audit
    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: isDemo ? "demo.company.created" : "company.created",
      companyId,
      targetUid: verifiedOwnerUid || undefined,
      after: {
        companyId,
        name: companyRecord.name,
        organizationType,
        isDemo,
        ...(companyRecord.demoExpiresAt ? { demoExpiresAt: companyRecord.demoExpiresAt } : {}),
        ...(verifiedOwnerUid ? { initialOwnerUid: verifiedOwnerUid, initialOwnerEmail: verifiedOwnerEmail } : {}),
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

      const isDemo = Boolean(compData.isDemo || compData.organizationType === "DEMO" || summary?.isDemo || summary?.organizationType === "DEMO");
      const organizationType: "NORMAL" | "DEMO" = isDemo ? "DEMO" : "NORMAL";

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
        organizationType,
        isDemo,
        demoExpiresAt: compData.demoExpiresAt || summary?.demoExpiresAt,
        demoDescription: compData.demoDescription || summary?.demoDescription,
        internalNote: compData.internalNote,
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

/**
 * Reset Demo Organization.
 * Strictly checks that organizationType === "DEMO" or isDemo === true.
 * Requires exact organization name confirmation.
 * Removes operational data and triggers client cache invalidation without touching user/membership configs.
 */
export async function resetDemoCompanyAsPlatformAdmin(input: {
  idToken: string;
  companyId: string;
  confirmName: string;
}) {
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

  const compSnap = await db.ref(`companies/${input.companyId}`).once("value");
  if (!compSnap.exists()) {
    return {
      success: false,
      error: "Company does not exist.",
      code: "NOT_FOUND",
    };
  }

  const company = compSnap.val();
  const isDemo = company.isDemo === true || company.organizationType === "DEMO";
  if (!isDemo) {
    return {
      success: false,
      error: "Reset is strictly restricted to Demo Organizations. Normal organizations cannot be reset through this action.",
      code: "CANNOT_RESET_NORMAL_ORGANIZATION",
    };
  }

  if (input.confirmName?.trim().toLowerCase() !== company.name?.trim().toLowerCase()) {
    return {
      success: false,
      error: "Confirmation name does not match the organization name.",
      code: "NAME_CONFIRMATION_MISMATCH",
    };
  }

  const now = Date.now();
  const operationalCollections = [
    "parties",
    "customers",
    "suppliers",
    "productSizes",
    "sizes",
    "products",
    "categories",
    "quotations",
    "invoices",
    "purchases",
    "receipts",
    "payments",
    "vouchers",
    "voucherLines",
    "voucherMutations",
    "allocations",
    "receiptAllocations",
    "paymentAllocations",
    "stockMovements",
    "transactionSummaries",
    "reportMaterializations",
    "legacyPartyMappings",
    "partyMutations",
    "docCounters",
    "partyNumbering",
  ];

  const updates: Record<string, any> = {};
  for (const col of operationalCollections) {
    updates[`companyData/${input.companyId}/${col}`] = null;
  }

  // Trigger operational reset event for all connected clients
  updates[`companyData/${input.companyId}/operationalReset`] = {
    completedAt: now,
    performedBy: callerUid,
    type: "DEMO_RESET",
  };

  updates[`companyData/${input.companyId}/auditLogs/reset_${now}`] = {
    id: `reset_${now}`,
    entityType: "company",
    action: "demo_organization_reset",
    timestamp: now,
    performedBy: callerUid,
    details: { collectionsWiped: operationalCollections },
  };

  try {
    await db.ref().update(updates);

    // Ensure Chart of Accounts is cleanly initialized
    await ensureChartOfAccounts(input.companyId);

    // Record Platform Audit
    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "demo.reset",
      companyId: input.companyId,
      after: {
        companyId: input.companyId,
        companyName: company.name,
        resetAt: now,
      },
    });

    return {
      success: true,
      companyId: input.companyId,
      resetAt: now,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reset demo organization";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Initialize Demo Data for a Demo Organization.
 * Populates realistic fictional dataset (2 customers, 1 supplier, 5 products, 2 quotations, 1 invoice, 1 receipt, 1 purchase)
 * using standard canonical schema with double-entry voucher posting.
 */
export async function initializeDemoDataAsPlatformAdmin(input: {
  idToken: string;
  companyId: string;
}) {
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

  const compSnap = await db.ref(`companies/${input.companyId}`).once("value");
  if (!compSnap.exists()) {
    return { success: false, error: "Company not found", code: "NOT_FOUND" };
  }

  const company = compSnap.val();
  const isDemo = company.isDemo === true || company.organizationType === "DEMO";
  if (!isDemo) {
    return {
      success: false,
      error: "Initialize Demo Data is only available for Demo Organizations.",
      code: "NOT_A_DEMO_COMPANY",
    };
  }

  // Ensure Chart of Accounts is initialized first
  await ensureChartOfAccounts(input.companyId);

  // Fetch financial year for company
  const fySnap = await db.ref(`companyData/${input.companyId}/financialYears`).once("value");
  const fyData = fySnap.val() || {};
  const currentFyId = Object.keys(fyData)[0] || `fy_${Date.now()}`;

  const now = Date.now();
  const companyId = input.companyId;
  const updates: Record<string, any> = {};

  // 1. Categories
  const cat1 = { id: `cat_${now}_1`, name: "Portable Cabins & Enclosures", createdAt: now - 86400000 * 5 };
  const cat2 = { id: `cat_${now}_2`, name: "Panels & Structural Materials", createdAt: now - 86400000 * 5 };
  updates[`companyData/${companyId}/categories/${cat1.id}`] = cat1;
  updates[`companyData/${companyId}/categories/${cat2.id}`] = cat2;

  // 2. Products (5 realistic fictional items)
  const products = [
    {
      id: `prod_${now}_1`,
      name: "Standard Security Cabin 10x8",
      sku: "CAB-SEC-1008",
      categoryId: cat1.id,
      unit: "NOS",
      hsn: "94069090",
      gstRate: 18,
      purchasePrice: 62000,
      sellingPrice: 85000,
      openingStock: 5,
      currentStock: 5,
      reorderLevel: 2,
      trackInventory: true,
      description: "Heavy-duty MS fabricated security guard cabin with PVC ceiling and pre-wired lighting.",
      active: true,
      createdAt: now - 86400000 * 5,
    },
    {
      id: `prod_${now}_2`,
      name: "Executive Site Office 20x10",
      sku: "CAB-OFF-2010",
      categoryId: cat1.id,
      unit: "NOS",
      hsn: "94069090",
      gstRate: 18,
      purchasePrice: 180000,
      sellingPrice: 245000,
      openingStock: 3,
      currentStock: 3,
      reorderLevel: 1,
      trackInventory: true,
      description: "Air-conditioned prefab site office with aluminum sliding windows and vinyl flooring.",
      active: true,
      createdAt: now - 86400000 * 5,
    },
    {
      id: `prod_${now}_3`,
      name: "Modular Bunkhouse Unit 20x10",
      sku: "CAB-BNK-2010",
      categoryId: cat1.id,
      unit: "NOS",
      hsn: "94069090",
      gstRate: 18,
      purchasePrice: 215000,
      sellingPrice: 290000,
      openingStock: 2,
      currentStock: 2,
      reorderLevel: 1,
      trackInventory: true,
      description: "6-bed insulated bunkhouse cabin for construction and industrial field staff.",
      active: true,
      createdAt: now - 86400000 * 5,
    },
    {
      id: `prod_${now}_4`,
      name: "Portable Sanitation / Toilet Unit 4x4",
      sku: "CAB-TOI-0404",
      categoryId: cat1.id,
      unit: "NOS",
      hsn: "94069090",
      gstRate: 18,
      purchasePrice: 32000,
      sellingPrice: 45000,
      openingStock: 4,
      currentStock: 4,
      reorderLevel: 2,
      trackInventory: true,
      description: "Self-contained FRP portable restroom unit with plumbing and internal ventilation.",
      active: true,
      createdAt: now - 86400000 * 5,
    },
    {
      id: `prod_${now}_5`,
      name: "PUFF Insulated Wall Panel 50mm",
      sku: "PNL-PUF-0050",
      categoryId: cat2.id,
      unit: "SQFT",
      hsn: "73089090",
      gstRate: 18,
      purchasePrice: 88,
      sellingPrice: 120,
      openingStock: 500,
      currentStock: 500,
      reorderLevel: 100,
      trackInventory: true,
      description: "High-density polyurethane foam sandwich panel for modular building construction.",
      active: true,
      createdAt: now - 86400000 * 5,
    },
  ];

  for (const p of products) {
    updates[`companyData/${companyId}/products/${p.id}`] = p;
  }

  // 3. Parties (2 customers, 1 supplier)
  const cus1Id = `pty_${now}_cus1`;
  const cus2Id = `pty_${now}_cus2`;
  const sup1Id = `pty_${now}_sup1`;

  const cus1LedgerId = `led_${companyId}_ar_${cus1Id}`;
  const cus2LedgerId = `led_${companyId}_ar_${cus2Id}`;
  const sup1LedgerId = `led_${companyId}_ap_${sup1Id}`;

  const customer1 = {
    id: cus1Id,
    partyCode: "CUS-DEMO-0001",
    name: "Acme Horizon Logistics Pvt Ltd",
    tradingName: "Acme Horizon Logistics",
    partyType: "CUSTOMER",
    mobile: "9820011223",
    email: "accounts@acmehorizon-demo.com",
    gstin: "27AABCA1234F1Z1",
    pan: "AABCA1234F",
    address: "Plot 42, Logistics Park, JNPT Road",
    city: "Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    country: "India",
    pincode: "400001",
    openingBalance: 0,
    ledgerId: cus1LedgerId,
    active: true,
    createdAt: now - 86400000 * 4,
  };

  const customer2 = {
    id: cus2Id,
    partyCode: "CUS-DEMO-0002",
    name: "Apex Skyline Infrastructure",
    tradingName: "Apex Skyline Infra",
    partyType: "CUSTOMER",
    mobile: "9820044556",
    email: "procurement@apexskyline-demo.com",
    gstin: "27AABCA5678F1Z9",
    pan: "AABCA5678F",
    address: "Tower 3, Baner Commercial Zone",
    city: "Pune",
    state: "Maharashtra",
    stateCode: "27",
    country: "India",
    pincode: "411057",
    openingBalance: 0,
    ledgerId: cus2LedgerId,
    active: true,
    createdAt: now - 86400000 * 3,
  };

  const supplier1 = {
    id: sup1Id,
    partyCode: "SUP-DEMO-0001",
    name: "Tata Structural Steel Supplies",
    tradingName: "Tata Structural Steel",
    partyType: "SUPPLIER",
    mobile: "9820077889",
    email: "orders@tatasteel-demo.com",
    gstin: "27AABCT9999K1Z4",
    pan: "AABCT9999K",
    address: "Steel Yard 12, Kalamboli Iron Market",
    city: "Navi Mumbai",
    state: "Maharashtra",
    stateCode: "27",
    country: "India",
    pincode: "400703",
    openingBalance: 0,
    apLedgerId: sup1LedgerId,
    active: true,
    createdAt: now - 86400000 * 5,
  };

  updates[`companyData/${companyId}/parties/${cus1Id}`] = customer1;
  updates[`companyData/${companyId}/parties/${cus2Id}`] = customer2;
  updates[`companyData/${companyId}/parties/${sup1Id}`] = supplier1;

  updates[`companyData/${companyId}/customers/${cus1Id}`] = customer1;
  updates[`companyData/${companyId}/customers/${cus2Id}`] = customer2;
  updates[`companyData/${companyId}/suppliers/${sup1Id}`] = supplier1;

  // 4. Ledgers for parties
  updates[`companyData/${companyId}/ledgers/${cus1LedgerId}`] = {
    id: cus1LedgerId,
    companyId,
    name: customer1.name,
    groupId: "grp_sundry_debtors",
    groupNature: "asset",
    openingBalance: 0,
    openingBalanceType: "dr",
    currentBalance: 18940000, // 3,89,400 invoice - 2,00,000 receipt = 1,89,400 Dr (in paise)
    currency: "INR",
    partyType: "customer",
    partyId: cus1Id,
    active: true,
    createdAt: now - 86400000 * 4,
    updatedAt: now,
  };

  updates[`companyData/${companyId}/ledgers/${cus2LedgerId}`] = {
    id: cus2LedgerId,
    companyId,
    name: customer2.name,
    groupId: "grp_sundry_debtors",
    groupNature: "asset",
    openingBalance: 0,
    openingBalanceType: "dr",
    currentBalance: 0,
    currency: "INR",
    partyType: "customer",
    partyId: cus2Id,
    active: true,
    createdAt: now - 86400000 * 3,
    updatedAt: now,
  };

  updates[`companyData/${companyId}/ledgers/${sup1LedgerId}`] = {
    id: sup1LedgerId,
    companyId,
    name: supplier1.name,
    groupId: "grp_sundry_creditors",
    groupNature: "liability",
    openingBalance: 0,
    openingBalanceType: "cr",
    currentBalance: 5192000, // 51,920 Cr (in paise)
    currency: "INR",
    partyType: "supplier",
    partyId: sup1Id,
    active: true,
    createdAt: now - 86400000 * 5,
    updatedAt: now,
  };

  // Update default system ledgers with corresponding balances
  updates[`companyData/${companyId}/ledgers/led_${companyId}_bank/currentBalance`] = 20000000; // 2,00,000 Dr
  updates[`companyData/${companyId}/ledgers/led_${companyId}_sales/currentBalance`] = 33000000; // 3,30,000 Cr
  updates[`companyData/${companyId}/ledgers/led_${companyId}_purchase/currentBalance`] = 4400000; // 44,000 Dr
  updates[`companyData/${companyId}/ledgers/led_${companyId}_output_gst/currentBalance`] = 5940000; // 59,400 Cr
  updates[`companyData/${companyId}/ledgers/led_${companyId}_input_gst/currentBalance`] = 792000; // 7,920 Dr

  // 5. Quotation 1 (Accepted)
  const qt1Id = `qt_${now}_1`;
  const qt1 = {
    id: qt1Id,
    number: "QT/2026-27/0001",
    date: now - 86400000 * 2,
    customerId: cus1Id,
    customerSnapshot: customer1,
    status: "accepted",
    subtotal: 330000,
    discountTotal: 0,
    gstTotal: 59400,
    cgstTotal: 29700,
    sgstTotal: 29700,
    igstTotal: 0,
    isIgst: false,
    roundOff: 0,
    grandTotal: 389400,
    financialYearId: currentFyId,
    items: [
      {
        productId: products[1].id,
        name: products[1].name,
        quantity: 1,
        unit: "NOS",
        rate: 245000,
        discountPct: 0,
        gstRate: 18,
        taxable: 245000,
        gstAmount: 44100,
        total: 289100,
      },
      {
        productId: products[0].id,
        name: products[0].name,
        quantity: 1,
        unit: "NOS",
        rate: 85000,
        discountPct: 0,
        gstRate: 18,
        taxable: 85000,
        gstAmount: 15300,
        total: 100300,
      },
    ],
    createdAt: now - 86400000 * 2,
  };
  updates[`companyData/${companyId}/quotations/${qt1Id}`] = qt1;

  // 6. Quotation 2 (Draft)
  const qt2Id = `qt_${now}_2`;
  const qt2 = {
    id: qt2Id,
    number: "QT/2026-27/0002",
    date: now - 86400000,
    customerId: cus2Id,
    customerSnapshot: customer2,
    status: "draft",
    subtotal: 290000,
    discountTotal: 0,
    gstTotal: 52200,
    cgstTotal: 26100,
    sgstTotal: 26100,
    igstTotal: 0,
    isIgst: false,
    roundOff: 0,
    grandTotal: 342200,
    financialYearId: currentFyId,
    items: [
      {
        productId: products[2].id,
        name: products[2].name,
        quantity: 1,
        unit: "NOS",
        rate: 290000,
        discountPct: 0,
        gstRate: 18,
        taxable: 290000,
        gstAmount: 52200,
        total: 342200,
      },
    ],
    createdAt: now - 86400000,
  };
  updates[`companyData/${companyId}/quotations/${qt2Id}`] = qt2;

  // 7. Invoice 1 (Posted)
  const inv1Id = `inv_${now}_1`;
  const vchInv1Id = `vch_${now}_inv1`;
  const inv1 = {
    id: inv1Id,
    number: "INV/2026-27/0001",
    date: now - 86400000 * 2,
    customerId: cus1Id,
    customerSnapshot: customer1,
    status: "partial",
    postingStatus: "posted",
    voucherId: vchInv1Id,
    sourceType: "QUOTATION",
    sourceQuotationId: qt1Id,
    sourceQuotationNumber: "QT/2026-27/0001",
    subtotal: 330000,
    discountTotal: 0,
    taxableAmount: 330000,
    cgstTotal: 29700,
    sgstTotal: 29700,
    igstTotal: 0,
    gstTotal: 59400,
    roundOff: 0,
    grandTotal: 389400,
    amountPaid: 200000,
    balance: 189400,
    isIgst: false,
    financialYearId: currentFyId,
    items: qt1.items,
    createdAt: now - 86400000 * 2,
  };
  updates[`companyData/${companyId}/invoices/${inv1Id}`] = inv1;

  // Double-entry voucher for invoice
  const vchInv1 = {
    id: vchInv1Id,
    companyId,
    financialYearId: currentFyId,
    voucherNumber: "VCH/SALES/0001",
    voucherType: "sales",
    date: now - 86400000 * 2,
    status: "posted",
    totalDebit: 38940000,
    totalCredit: 38940000,
    narration: "Being sales invoice INV/2026-27/0001 issued to Acme Horizon Logistics Pvt Ltd",
    documentId: inv1Id,
    documentType: "invoice",
    lines: [
      {
        id: `line_${vchInv1Id}_1`,
        voucherId: vchInv1Id,
        ledgerId: cus1LedgerId,
        side: "debit",
        debit: 38940000,
        credit: 0,
        partyId: cus1Id,
        partyType: "customer",
      },
      {
        id: `line_${vchInv1Id}_2`,
        voucherId: vchInv1Id,
        ledgerId: `led_${companyId}_sales`,
        side: "credit",
        debit: 0,
        credit: 33000000,
      },
      {
        id: `line_${vchInv1Id}_3`,
        voucherId: vchInv1Id,
        ledgerId: `led_${companyId}_output_gst`,
        side: "credit",
        debit: 0,
        credit: 5940000,
      },
    ],
    createdAt: now - 86400000 * 2,
    createdBy: callerUid,
  };
  updates[`companyData/${companyId}/vouchers/${vchInv1Id}`] = vchInv1;

  // 8. Receipt 1 (Posted)
  const rcp1Id = `rcp_${now}_1`;
  const vchRcp1Id = `vch_${now}_rcp1`;
  const rcp1 = {
    id: rcp1Id,
    number: "RCP/2026-27/0001",
    date: now - 86400000,
    customerId: cus1Id,
    invoiceId: inv1Id,
    amount: 200000,
    mode: "bank",
    reference: "NEFT-DEMO-7711",
    postingStatus: "posted",
    voucherId: vchRcp1Id,
    financialYearId: currentFyId,
    allocatedInvoices: [
      {
        invoiceId: inv1Id,
        invoiceNumber: "INV/2026-27/0001",
        amountPaise: 20000000,
      },
    ],
    createdAt: now - 86400000,
  };
  updates[`companyData/${companyId}/receipts/${rcp1Id}`] = rcp1;

  const vchRcp1 = {
    id: vchRcp1Id,
    companyId,
    financialYearId: currentFyId,
    voucherNumber: "VCH/RCP/0001",
    voucherType: "receipt",
    date: now - 86400000,
    status: "posted",
    totalDebit: 20000000,
    totalCredit: 20000000,
    narration: "Being payment received via NEFT from Acme Horizon Logistics against INV/2026-27/0001",
    documentId: rcp1Id,
    documentType: "receipt",
    lines: [
      {
        id: `line_${vchRcp1Id}_1`,
        voucherId: vchRcp1Id,
        ledgerId: `led_${companyId}_bank`,
        side: "debit",
        debit: 20000000,
        credit: 0,
      },
      {
        id: `line_${vchRcp1Id}_2`,
        voucherId: vchRcp1Id,
        ledgerId: cus1LedgerId,
        side: "credit",
        debit: 0,
        credit: 20000000,
        partyId: cus1Id,
        partyType: "customer",
      },
    ],
    createdAt: now - 86400000,
    createdBy: callerUid,
  };
  updates[`companyData/${companyId}/vouchers/${vchRcp1Id}`] = vchRcp1;

  // 9. Purchase 1 (Posted)
  const pur1Id = `pur_${now}_1`;
  const vchPur1Id = `vch_${now}_pur1`;
  const pur1 = {
    id: pur1Id,
    number: "PUR/2026-27/0001",
    supplierInvoiceNumber: "TATA-INV-4412",
    date: now - 86400000 * 3,
    supplierId: sup1Id,
    supplierSnapshot: supplier1,
    status: "unpaid",
    postingStatus: "posted",
    voucherId: vchPur1Id,
    financialYearId: currentFyId,
    subtotal: 44000,
    discountTotal: 0,
    cgstTotal: 3960,
    sgstTotal: 3960,
    igstTotal: 0,
    gstTotal: 7920,
    roundOff: 0,
    grandTotal: 51920,
    amountPaid: 0,
    balance: 51920,
    items: [
      {
        productId: products[4].id,
        name: products[4].name,
        quantity: 500,
        unit: "SQFT",
        rate: 88,
        discountPct: 0,
        gstRate: 18,
        taxable: 44000,
        gstAmount: 7920,
        total: 51920,
      },
    ],
    createdAt: now - 86400000 * 3,
  };
  updates[`companyData/${companyId}/purchases/${pur1Id}`] = pur1;

  const vchPur1 = {
    id: vchPur1Id,
    companyId,
    financialYearId: currentFyId,
    voucherNumber: "VCH/PUR/0001",
    voucherType: "purchase",
    date: now - 86400000 * 3,
    status: "posted",
    totalDebit: 5192000,
    totalCredit: 5192000,
    narration: "Being purchase of PUFF insulated wall panels from Tata Structural Steel Supplies",
    documentId: pur1Id,
    documentType: "purchase",
    lines: [
      {
        id: `line_${vchPur1Id}_1`,
        voucherId: vchPur1Id,
        ledgerId: `led_${companyId}_purchase`,
        side: "debit",
        debit: 4400000,
        credit: 0,
      },
      {
        id: `line_${vchPur1Id}_2`,
        voucherId: vchPur1Id,
        ledgerId: `led_${companyId}_input_gst`,
        side: "debit",
        debit: 792000,
        credit: 0,
      },
      {
        id: `line_${vchPur1Id}_3`,
        voucherId: vchPur1Id,
        ledgerId: sup1LedgerId,
        side: "credit",
        debit: 0,
        credit: 5192000,
        partyId: sup1Id,
        partyType: "supplier",
      },
    ],
    createdAt: now - 86400000 * 3,
    createdBy: callerUid,
  };
  updates[`companyData/${companyId}/vouchers/${vchPur1Id}`] = vchPur1;

  // 10. Document Counters
  updates[`companyData/${companyId}/docCounters/quotations`] = 2;
  updates[`companyData/${companyId}/docCounters/invoices`] = 1;
  updates[`companyData/${companyId}/docCounters/receipts`] = 1;
  updates[`companyData/${companyId}/docCounters/purchases`] = 1;
  updates[`companyData/${companyId}/partyNumbering/customerSequence`] = 2;
  updates[`companyData/${companyId}/partyNumbering/supplierSequence`] = 1;

  // 11. Operational Reset trigger for real-time local cache synchronization
  updates[`companyData/${companyId}/operationalReset`] = {
    completedAt: now,
    performedBy: callerUid,
    type: "DEMO_DATA_INITIALIZED",
  };

  try {
    await db.ref().update(updates);

    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "demo.data.initialized",
      companyId,
      after: {
        companyId,
        companyName: company.name,
        customersCount: 2,
        suppliersCount: 1,
        productsCount: 5,
        quotationsCount: 2,
        invoicesCount: 1,
        receiptsCount: 1,
        purchasesCount: 1,
      },
    });

    return {
      success: true,
      companyId,
      message: "Demo dataset initialized successfully.",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to seed demo data";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }
}

/**
 * Extends the expiration date for a Demo Organization.
 */
export async function extendDemoExpirationAsPlatformAdmin(input: {
  idToken: string;
  companyId: string;
  demoExpiresAt: number;
}) {
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

  const compSnap = await db.ref(`companies/${input.companyId}`).once("value");
  if (!compSnap.exists()) {
    return { success: false, error: "Company not found", code: "NOT_FOUND" };
  }

  const comp = compSnap.val();
  const isDemo = Boolean(comp.isDemo || comp.organizationType === "DEMO");
  if (!isDemo) {
    return { success: false, error: "Only demo organizations can have expiration configured.", code: "INVALID_OPERATION" };
  }

  const now = Date.now();
  const updates: Record<string, any> = {
    [`companies/${input.companyId}/demoExpiresAt`]: input.demoExpiresAt,
    [`companySummaries/${input.companyId}/demoExpiresAt`]: input.demoExpiresAt,
    [`companies/${input.companyId}/updatedAt`]: now,
  };

  await db.ref().update(updates);

  await recordPlatformAuditLog(db, {
    actorUid: callerUid,
    action: "demo.extended",
    companyId: input.companyId,
    after: { demoExpiresAt: input.demoExpiresAt },
  });

  return { success: true, demoExpiresAt: input.demoExpiresAt };
}

/**
 * Open Organization for Platform Admin.
 * Verifies Platform Admin identity, ensures explicit audited membership exists,
 * allowing safe traversal without bypassing security rules.
 */
export async function openOrganizationForAdmin(input: {
  idToken: string;
  companyId: string;
}) {
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

  const compSnap = await db.ref(`companies/${input.companyId}`).once("value");
  if (!compSnap.exists()) {
    return { success: false, error: "Company not found", code: "NOT_FOUND" };
  }

  const memSnap = await db.ref(`memberships/${input.companyId}/${callerUid}`).once("value");
  const now = Date.now();

  if (!memSnap.exists()) {
    const memRecord = {
      uid: callerUid,
      role: "owner",
      roleId: "owner",
      status: "active",
      branchIds: { br_main: true },
      customPermissions: [],
      createdAt: now,
      createdBy: callerUid,
      updatedAt: now,
      note: "Explicit Platform Admin entrance",
    };

    const updates: Record<string, any> = {};
    updates[`memberships/${input.companyId}/${callerUid}`] = memRecord;
    updates[`userCompanies/${callerUid}/${input.companyId}`] = true;
    await db.ref().update(updates);

    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "company.access.granted",
      companyId: input.companyId,
      targetUid: callerUid,
      after: { callerUid, assignedRole: "owner" },
    });
  } else if (memSnap.val().status !== "active") {
    await db.ref(`memberships/${input.companyId}/${callerUid}/status`).set("active");
    await db.ref(`userCompanies/${callerUid}/${input.companyId}`).set(true);

    await recordPlatformAuditLog(db, {
      actorUid: callerUid,
      action: "company.access.reactivated",
      companyId: input.companyId,
      targetUid: callerUid,
    });
  }

  return {
    success: true,
    companyId: input.companyId,
  };
}

