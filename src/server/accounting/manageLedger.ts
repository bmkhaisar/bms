import { getFirebaseAdmin } from "../firebaseAdmin";
import { hasCapability } from "@/modules/auth/permissions";
import type {
  ManageLedgerInput,
  ManageLedgerResult,
  Ledger,
  AccountGroup,
  AccountNature,
} from "@/modules/accounting/types";
import { rupeesToPaise } from "@/modules/accounting/constants";
import { SYSTEM_ACCOUNT_GROUPS } from "@/modules/accounting/defaultGroups";

/**
 * Server-Side Ledger Master Manager.
 * 
 * Supports:
 * - General Ledgers & Sub-ledgers
 * - Party linkage (Customer / Supplier)
 * - Bank / Liquidity metadata (Account number, IFSC, UPI)
 * - Opening balance integration in integer paise with double-entry offset maintenance
 * - Active / Inactive status tracking
 * - Audit logging
 */
export async function executeManageLedger(
  input: ManageLedgerInput
): Promise<ManageLedgerResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials must be configured on the server.",
      code: "INTERNAL_ERROR",
    };
  }

  if (!input.idToken) {
    return {
      success: false,
      error: "Authentication token required.",
      code: "UNAUTHORIZED",
    };
  }

  if (!input.companyId || !input.name?.trim() || !input.groupId?.trim()) {
    return {
      success: false,
      error: "Company ID, ledger name, and account group ID are required.",
      code: "INVALID_INPUT",
    };
  }

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
  const db = adminApp.database();

  // Verify membership & permissions
  const memSnap = await db.ref(`memberships/${input.companyId}/${callerUid}`).once("value");
  if (!memSnap.exists()) {
    return {
      success: false,
      error: "You are not a member of this company.",
      code: "FORBIDDEN",
    };
  }

  const membership = memSnap.val();
  if (membership.status !== "active") {
    return {
      success: false,
      error: "Your membership is inactive or suspended.",
      code: "FORBIDDEN",
    };
  }

  if (!hasCapability(membership, "accounting.chart.manage") && membership.role !== "owner" && membership.role !== "accountant") {
    return {
      success: false,
      error: "Forbidden: You do not have permission to manage ledgers.",
      code: "FORBIDDEN",
    };
  }

  // 1. Resolve Account Group and inherit groupNature
  const groupId = input.groupId.trim();
  let groupNature: AccountNature | undefined;

  const sysGroup = SYSTEM_ACCOUNT_GROUPS.find((g) => g.id === groupId);
  if (sysGroup) {
    groupNature = sysGroup.nature;
  } else {
    const grpSnap = await db.ref(`companyData/${input.companyId}/accountGroups/${groupId}`).once("value");
    if (grpSnap.exists()) {
      groupNature = (grpSnap.val() as AccountGroup).nature;
    }
  }

  if (!groupNature) {
    return {
      success: false,
      error: `Account group '${groupId}' does not exist.`,
      code: "INVALID_INPUT",
    };
  }

  // 2. Parse Opening Balance in Integer Paise
  const rawOpening = input.openingBalance ?? 0;
  const openingPaise = input.amountsInRupees ? rupeesToPaise(rawOpening) : Math.round(rawOpening);
  const openingType: "dr" | "cr" = input.openingBalanceType === "cr" ? "cr" : "dr";

  if (openingPaise < 0) {
    return {
      success: false,
      error: "Opening balance cannot be negative. Use Dr/Cr classification.",
      code: "INVALID_INPUT",
    };
  }

  const now = Date.now();
  const ledgerId =
    input.ledgerId?.trim() ||
    `led_${input.companyId}_${Math.random().toString(36).substring(2, 9)}`;
  const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

  // 3. Load existing ledger if updating
  let existingLedger: Ledger | null = null;
  if (input.ledgerId) {
    const existSnap = await db.ref(`companyData/${input.companyId}/ledgers/${ledgerId}`).once("value");
    if (existSnap.exists()) {
      existingLedger = existSnap.val() as Ledger;
    }
  }

  // Prevent deactivation of foundational system ledgers
  const isSystemLedger = existingLedger?.isSystem ?? (ledgerId.includes("_cash") || ledgerId.includes("_opening_offset"));
  if (isSystemLedger && input.active === false) {
    return {
      success: false,
      error: "System foundational ledgers cannot be deactivated.",
      code: "FORBIDDEN",
    };
  }

  // Calculate new currentBalance
  // If new ledger: currentBalance = opening Dr - Cr
  // If existing ledger: adjust currentBalance by the delta of opening balance changes
  let currentBalancePaise = 0;
  let openingDelta = 0;

  const newOpeningSigned = openingType === "dr" ? openingPaise : -openingPaise;

  if (existingLedger) {
    const oldOpeningSigned =
      existingLedger.openingBalanceType === "dr"
        ? existingLedger.openingBalance || 0
        : -(existingLedger.openingBalance || 0);
    openingDelta = newOpeningSigned - oldOpeningSigned;
    currentBalancePaise = (existingLedger.currentBalance || 0) + openingDelta;
  } else {
    currentBalancePaise = newOpeningSigned;
    openingDelta = newOpeningSigned;
  }

  const normalBalance: "debit" | "credit" = (groupNature === "asset" || groupNature === "expense") ? "debit" : "credit";

  const ledger: Ledger = {
    id: ledgerId,
    companyId: input.companyId,
    name: input.name.trim(),
    code: input.code?.trim() || undefined,
    groupId,
    groupNature,
    normalBalance,
    openingBalance: openingPaise,
    openingBalanceType: openingType,
    currentBalance: currentBalancePaise,
    currency: "INR",
    gstin: input.gstin?.trim()?.toUpperCase() || undefined,
    pan: input.pan?.trim()?.toUpperCase() || undefined,
    partyType: input.partyType || "general",
    partyId: input.partyId?.trim() || undefined,
    bankDetails: input.bankDetails,
    isSystem: isSystemLedger,
    active: input.active !== false,
    createdAt: existingLedger?.createdAt || now,
    updatedAt: now,
  };

  const updates: Record<string, unknown> = {};
  updates[`companyData/${input.companyId}/ledgers/${ledgerId}`] = ledger;

  // 4. Update Opening Balance Offset Ledger (Equity) to balance double entry
  // The Offset account counterbalances all ledger opening balances
  if (openingDelta !== 0) {
    const offsetLedgerId = `led_${input.companyId}_opening_offset`;
    const offsetSnap = await db.ref(`companyData/${input.companyId}/ledgers/${offsetLedgerId}`).once("value");
    if (offsetSnap.exists()) {
      const offset = offsetSnap.val() as Ledger;
      // If assets/debtors increased by Dr (positive delta), offset must increase by Cr (negative delta)
      const newOffsetBal = (offset.currentBalance || 0) - openingDelta;
      updates[`companyData/${input.companyId}/ledgers/${offsetLedgerId}/currentBalance`] = newOffsetBal;
      updates[`companyData/${input.companyId}/ledgers/${offsetLedgerId}/updatedAt`] = now;
    }
  }

  // 5. Audit Log
  updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "ledger",
    entityId: ledgerId,
    action: existingLedger ? "update" : "create",
    performedBy: callerUid,
    timestamp: now,
    newState: {
      name: ledger.name,
      groupId: ledger.groupId,
      groupNature: ledger.groupNature,
      openingBalance: ledger.openingBalance,
      openingBalanceType: ledger.openingBalanceType,
      active: ledger.active,
    },
  };

  try {
    await db.ref().update(updates);
    return {
      success: true,
      ledger,
      ledgerId,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Database write failed";
    return {
      success: false,
      error: `Failed to save ledger: ${msg}`,
      code: "INTERNAL_ERROR",
    };
  }
}
