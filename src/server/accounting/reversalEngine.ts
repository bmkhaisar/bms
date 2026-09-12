import { getFirebaseAdmin } from "../firebaseAdmin";
import { hasCapability } from "@/modules/auth/permissions";
import type {
  ReverseVoucherInput,
  ReverseVoucherResult,
  Voucher,
  VoucherLine,
  Ledger,
} from "@/modules/accounting/types";
import { allocateVoucherNumber } from "./numberingEngine";

/**
 * Server-Side Voucher Reversal Engine.
 * 
 * Reversal Principles:
 * 1. Financial history is NEVER rewritten or deleted.
 * 2. An exact opposite counter-voucher is created and posted atomically.
 * 3. The original voucher is marked `status: "reversed"` and linked via `reversalVoucherId`.
 * 4. The reversal voucher links back via `reversedVoucherId`.
 * 5. Ledger balances are restored to their pre-voucher values.
 */
export async function executeReverseVoucher(
  input: ReverseVoucherInput
): Promise<ReverseVoucherResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials must be configured on the server to execute trusted reversal operations.",
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

  if (!input.companyId || !input.voucherId) {
    return {
      success: false,
      error: "Company ID and Voucher ID are required.",
      code: "INVALID_STATE",
    };
  }

  if (!input.clientMutationId?.trim()) {
    return {
      success: false,
      error: "A stable clientMutationId is required for idempotency.",
      code: "INVALID_STATE",
    };
  }

  // 1. Authenticate caller & verify permissions
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

  const memSnap = await db
    .ref(`memberships/${input.companyId}/${callerUid}`)
    .once("value");

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
      error: "Your membership in this company is inactive or suspended.",
      code: "FORBIDDEN",
    };
  }

  if (!hasCapability(membership, "accounting.voucher.void")) {
    return {
      success: false,
      error: "Forbidden: You do not have permission to reverse or void accounting vouchers.",
      code: "FORBIDDEN",
    };
  }

  // 2. Idempotency Check for Reversal Mutation
  const mutationSnap = await db
    .ref(`companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`)
    .once("value");

  if (mutationSnap.exists()) {
    const mut = mutationSnap.val();
    return {
      success: true,
      originalVoucherId: input.voucherId,
      reversalVoucherId: mut.voucherId,
      reversalVoucherNumber: mut.voucherNumber,
      alreadyReversed: true,
    };
  }

  // 3. Load Original Voucher
  const origVoucherSnap = await db
    .ref(`companyData/${input.companyId}/vouchers/${input.voucherId}`)
    .once("value");

  if (!origVoucherSnap.exists()) {
    return {
      success: false,
      error: "Original voucher not found.",
      code: "NOT_FOUND",
    };
  }

  const origVoucher = origVoucherSnap.val() as Voucher;

  if (origVoucher.status === "reversed") {
    return {
      success: true,
      originalVoucherId: origVoucher.id,
      reversalVoucherId: origVoucher.reversalVoucherId,
      alreadyReversed: true,
    };
  }

  if (origVoucher.status !== "posted") {
    return {
      success: false,
      error: `Voucher cannot be reversed because it is in '${origVoucher.status}' status. Only posted vouchers can be reversed.`,
      code: "INVALID_STATE",
    };
  }

  // Verify Financial Year
  const fySnap = await db
    .ref(`companyData/${input.companyId}/financialYears/${origVoucher.financialYearId}`)
    .once("value");

  if (!fySnap.exists()) {
    return {
      success: false,
      error: "Financial year not found.",
      code: "INVALID_STATE",
    };
  }

  const fy = fySnap.val();
  if (fy.locked) {
    return {
      success: false,
      error: "Financial year is locked. Vouchers in locked periods cannot be reversed.",
      code: "INVALID_STATE",
    };
  }

  // 4. Generate Equal Opposite Counter-Entries
  const reversalLines: VoucherLine[] = origVoucher.lines.map((origLine, idx) => ({
    id: `rev_line_${idx + 1}_${Math.random().toString(36).substring(2, 6)}`,
    ledgerId: origLine.ledgerId,
    ledgerName: origLine.ledgerName,
    debit: origLine.credit,    // Swap: Original credit becomes debit
    credit: origLine.debit,    // Swap: Original debit becomes credit
    description: `Reversal of [${origVoucher.voucherNumber}] ${origLine.description || ""}`.trim(),
    partyType: origLine.partyType,
    partyId: origLine.partyId,
  }));

  // 5. Allocate Sequence Number for Reversal Voucher
  let reversalNumberInfo;
  try {
    reversalNumberInfo = await allocateVoucherNumber(
      db,
      input.companyId,
      origVoucher.financialYearId,
      fy.name,
      origVoucher.voucherType
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to allocate reversal voucher number";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }

  const now = Date.now();
  let canonicalReversalDate: string;
  let revDateMs: number;
  if (typeof input.reversalDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.reversalDate as string)) {
    canonicalReversalDate = input.reversalDate as string;
    revDateMs = new Date(`${input.reversalDate}T12:00:00Z`).getTime();
  } else if (typeof input.reversalDate === "number") {
    revDateMs = input.reversalDate;
    canonicalReversalDate = new Date(input.reversalDate).toISOString().slice(0, 10);
  } else {
    revDateMs = now;
    canonicalReversalDate = new Date().toISOString().slice(0, 10);
  }

  if (revDateMs < fy.startDate || revDateMs > fy.endDate) {
    return {
      success: false,
      error: `Reversal date (${canonicalReversalDate}) must fall within the open financial year period. Reversals cannot rewrite closed financial periods.`,
      code: "INVALID_STATE",
    };
  }

  const reversalVoucherId = `vouch_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

  const reversalVoucher: Voucher = {
    id: reversalVoucherId,
    companyId: input.companyId,
    financialYearId: origVoucher.financialYearId,
    branchId: origVoucher.branchId,
    voucherType: origVoucher.voucherType,
    voucherNumber: reversalNumberInfo.voucherNumber,
    date: canonicalReversalDate as any,
    reference: origVoucher.voucherNumber,
    narration: `Reversal of ${origVoucher.voucherNumber}: ${input.reversalReason || "Entry voided"}`,
    status: "posted",
    lines: reversalLines,
    totalDebit: origVoucher.totalCredit,
    totalCredit: origVoucher.totalDebit,
    sourceType: "reversal",
    sourceId: origVoucher.id,
    sourceNumber: origVoucher.voucherNumber,
    clientMutationId: input.clientMutationId.trim(),
    createdBy: callerUid,
    createdAt: now,
    postedBy: callerUid,
    postedAt: now,
    reversedVoucherId: origVoucher.id,
  };

  // 6. Prepare Atomic Multi-Path RTDB Updates
  const updates: Record<string, unknown> = {};

  // Update original voucher status to reversed
  updates[`companyData/${input.companyId}/vouchers/${origVoucher.id}/status`] = "reversed";
  updates[`companyData/${input.companyId}/vouchers/${origVoucher.id}/reversalVoucherId`] =
    reversalVoucherId;

  // Insert reversal voucher header and lines
  updates[`companyData/${input.companyId}/vouchers/${reversalVoucherId}`] = reversalVoucher;
  for (const line of reversalLines) {
    updates[
      `companyData/${input.companyId}/voucherLines/${reversalVoucherId}/${line.id}`
    ] = line;
  }

  // Restore Ledger Balances by applying opposite delta: (reversalDebit - reversalCredit)
  // Fetch current ledger balances
  const uniqueLedgerIds = Array.from(new Set(reversalLines.map((l) => l.ledgerId)));
  const ledgerSnaps = await Promise.all(
    uniqueLedgerIds.map((id) =>
      db.ref(`companyData/${input.companyId}/ledgers/${id}`).once("value")
    )
  );

  const loadedLedgers: Record<string, Ledger> = {};
  for (const snap of ledgerSnaps) {
    if (snap.exists()) {
      const l = snap.val() as Ledger;
      loadedLedgers[l.id] = l;
    }
  }

  for (const line of reversalLines) {
    const l = loadedLedgers[line.ledgerId];
    if (l) {
      const current = l.currentBalance || 0;
      const delta = line.debit - line.credit;
      const newBal = current + delta;
      updates[`companyData/${input.companyId}/ledgers/${line.ledgerId}/currentBalance`] =
        newBal;
      updates[`companyData/${input.companyId}/ledgers/${line.ledgerId}/updatedAt`] = now;
      l.currentBalance = newBal;
    }
  }

  // Mutation record
  updates[
    `companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`
  ] = {
    voucherId: reversalVoucherId,
    voucherNumber: reversalVoucher.voucherNumber,
    timestamp: now,
    performedBy: callerUid,
  };

  // Audit record
  updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "voucher",
    entityId: origVoucher.id,
    action: "reverse",
    performedBy: callerUid,
    timestamp: now,
    newState: {
      originalVoucherNumber: origVoucher.voucherNumber,
      reversalVoucherNumber: reversalVoucher.voucherNumber,
      reversalVoucherId,
      reason: input.reversalReason,
    },
  };

  try {
    await db.ref().update(updates);
    return {
      success: true,
      originalVoucherId: origVoucher.id,
      reversalVoucherId,
      reversalVoucherNumber: reversalVoucher.voucherNumber,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to execute voucher reversal";
    console.error("Failed to commit voucher reversal:", err);
    return {
      success: false,
      error: `Failed to commit voucher reversal: ${msg}`,
      code: "INTERNAL_ERROR",
    };
  }
}
