import { getFirebaseAdmin } from "../firebaseAdmin";
import { checkSessionAge } from "../authMiddleware";
import { hasCapability } from "@/modules/auth/permissions";
import type {
  PostVoucherInput,
  PostVoucherResult,
  Voucher,
  VoucherLine,
  Ledger,
} from "@/modules/accounting/types";
import { rupeesToPaise } from "@/modules/accounting/constants";
import { allocateVoucherNumber } from "./numberingEngine";
import { ensureCompanyChartOfAccounts } from "./initChartOfAccounts";

/**
 * Server-Side Double-Entry Posting Engine.
 * 
 * Invariants Enforced:
 * 1. Strict Double-Entry: Total Debit === Total Credit at integer paise precision.
 * 2. Minimum 2 lines, single side per line, no zero or negative lines.
 * 3. Idempotency via clientMutationId to eliminate duplicate postings.
 * 4. Concurrency-safe atomic voucher sequence numbering.
 * 5. All referenced ledgers belong to the active company.
 * 6. Contra vouchers strictly restricted to cash/bank liquidity ledgers.
 * 7. Transaction date verified within active financial year boundaries.
 * 8. User authenticated and authorized via capability checks.
 * 9. Atomic RTDB multi-path update with audit logging.
 */
export async function executePostVoucher(
  input: PostVoucherInput
): Promise<PostVoucherResult> {
  const adminApp = getFirebaseAdmin();
  if (!adminApp) {
    return {
      success: false,
      error: "Server configuration required. Firebase Admin credentials must be configured on the server to execute trusted posting operations.",
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

  if (!input.companyId || !input.financialYearId || !input.voucherType) {
    return {
      success: false,
      error: "Company ID, Financial Year ID, and Voucher Type are required.",
      code: "INVALID_INPUT",
    };
  }

  if (!input.clientMutationId?.trim()) {
    return {
      success: false,
      error: "A stable clientMutationId is required for idempotency.",
      code: "INVALID_INPUT",
    };
  }

  // 1. Authenticate caller & verify membership
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

  const sessionCheck = checkSessionAge(decodedToken);
  if (!sessionCheck.valid) {
    return {
      success: false,
      error: sessionCheck.error,
      code: sessionCheck.code,
    };
  }

  const callerUid = decodedToken.uid;
  const db = adminApp.database();

  // Verify membership & permissions
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

  if (!hasCapability(membership, "accounting.voucher.create")) {
    return {
      success: false,
      error: "Forbidden: You do not have permission to post accounting vouchers.",
      code: "FORBIDDEN",
    };
  }

  // Legacy-company compatibility: foundational system groups/ledgers may be
  // absent even though the tenant and membership are valid. This helper is
  // additive and reads existing records first, so balances are never reset.
  const chartResult = await ensureCompanyChartOfAccounts(db, input.companyId, callerUid);
  if (!chartResult.success) {
    return {
      success: false,
      error: chartResult.error || "Could not initialize the company chart of accounts.",
      code: "INTERNAL_ERROR",
    };
  }

  const payloadHash = JSON.stringify({
    companyId: input.companyId,
    financialYearId: input.financialYearId,
    voucherType: input.voucherType,
    lines: (input.lines || []).map((l) => ({ l: l.ledgerId, d: l.debit, c: l.credit })),
  });

  // 2. Idempotency Check: Verify if this clientMutationId was already posted
  const mutationSnap = await db
    .ref(`companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`)
    .once("value");

  if (mutationSnap.exists()) {
    const mutationData = mutationSnap.val();
    if (mutationData.payloadHash && mutationData.payloadHash !== payloadHash) {
      return {
        success: false,
        error: "Idempotency conflict: A previous request with the same clientMutationId was submitted with different payload data.",
        code: "INVALID_INPUT",
      };
    }

    const existingVoucherId = mutationData.voucherId;
    if (existingVoucherId) {
      const existingVoucherSnap = await db
        .ref(`companyData/${input.companyId}/vouchers/${existingVoucherId}`)
        .once("value");

      if (existingVoucherSnap.exists()) {
        const existingVoucher = existingVoucherSnap.val() as Voucher;
        return {
          success: true,
          voucher: existingVoucher,
          voucherId: existingVoucherId,
          voucherNumber: existingVoucher.voucherNumber,
          alreadyPosted: true,
          code: "ALREADY_POSTED",
        };
      }
    }
  }

  // 3. Verify Branch Exists and is Active
  const branchId = input.branchId || "br_main";
  let branchSnap = await db
    .ref(`companyData/${input.companyId}/branches/${branchId}`)
    .once("value");

  if (!branchSnap.exists()) {
    if (branchId !== "br_main") {
      return {
        success: false,
        error: `Branch '${branchId}' does not exist in this company.`,
        code: "INVALID_INPUT",
      };
    }

    const companySnap = await db.ref(`companies/${input.companyId}`).once("value");
    if (!companySnap.exists()) {
      return {
        success: false,
        error: "Company does not exist.",
        code: "INVALID_INPUT",
      };
    }

    const repairTime = Date.now();
    const defaultBranch = {
      id: "br_main",
      companyId: input.companyId,
      name: "Main Branch",
      code: "MAIN",
      isHeadOffice: true,
      active: true,
      createdAt: repairTime,
      createdBy: callerUid,
    };
    const branchRef = db.ref(`companyData/${input.companyId}/branches/br_main`);
    const repairTransaction = await branchRef.transaction((current) => current || defaultBranch);
    branchSnap = repairTransaction.snapshot;
    if (!branchSnap.exists()) {
      return {
        success: false,
        error: "Could not initialize the company's main branch.",
        code: "INTERNAL_ERROR",
      };
    }

    if (repairTransaction.committed) {
      const repairAuditId = `audit_${repairTime}_main_branch_repair`;
      await db.ref().update({
        [`memberships/${input.companyId}/${callerUid}/branchIds/br_main`]: true,
        [`companyData/${input.companyId}/auditLogs/${repairAuditId}`]: {
          id: repairAuditId,
          entityType: "branch",
          entityId: "br_main",
          action: "ensure_main_branch",
          performedBy: callerUid,
          timestamp: repairTime,
          details: { created: true, reason: "legacy_company_repair" },
        },
      });
    }
  }
  const branchData = branchSnap.val();
  if (branchData.active === false) {
    return {
      success: false,
      error: `Branch '${branchId}' is deactivated and cannot accept new postings.`,
      code: "INVALID_INPUT",
    };
  }

  // 4. Verify Financial Year & Date Bounds
  const fySnap = await db
    .ref(`companyData/${input.companyId}/financialYears/${input.financialYearId}`)
    .once("value");

  if (!fySnap.exists()) {
    return {
      success: false,
      error: "Specified Financial Year does not exist in this company.",
      code: "INVALID_INPUT",
    };
  }

  const fy = fySnap.val();
  if (fy.locked) {
    return {
      success: false,
      error: "This Financial Year is locked for posting.",
      code: "PERIOD_LOCKED",
    };
  }

  let canonicalDateStr: string;
  let voucherDateEpoch: number;
  if (typeof input.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    canonicalDateStr = input.date;
    voucherDateEpoch = new Date(`${input.date}T12:00:00Z`).getTime();
  } else if (typeof input.date === "number") {
    voucherDateEpoch = input.date;
    canonicalDateStr = new Date(input.date).toISOString().slice(0, 10);
  } else {
    voucherDateEpoch = Date.now();
    canonicalDateStr = new Date().toISOString().slice(0, 10);
  }

  if (voucherDateEpoch < fy.startDate || voucherDateEpoch > fy.endDate) {
    return {
      success: false,
      error: `Voucher date (${canonicalDateStr}) must fall within the financial year period (${new Date(
        fy.startDate
      ).toISOString().slice(0, 10)} - ${new Date(fy.endDate).toISOString().slice(0, 10)}).`,
      code: "INVALID_INPUT",
    };
  }

  // 4. Line Validation & Monetary Arithmetic in Integer Paise
  if (!Array.isArray(input.lines) || input.lines.length < 2) {
    return {
      success: false,
      error: "A double-entry voucher requires at least two lines.",
      code: "INVALID_INPUT",
    };
  }

  let totalDebitPaise = 0;
  let totalCreditPaise = 0;
  const processedLines: VoucherLine[] = [];
  const referencedLedgerIds = new Set<string>();

  for (let i = 0; i < input.lines.length; i++) {
    const rawLine = input.lines[i];
    if (!rawLine.ledgerId?.trim()) {
      return {
        success: false,
        error: `Line ${i + 1} must specify a valid ledgerId.`,
        code: "INVALID_INPUT",
      };
    }

    const debitPaise = input.amountsInRupees
      ? rupeesToPaise(rawLine.debit)
      : Math.round(rawLine.debit || 0);
    const creditPaise = input.amountsInRupees
      ? rupeesToPaise(rawLine.credit)
      : Math.round(rawLine.credit || 0);

    if (!Number.isSafeInteger(debitPaise) || !Number.isSafeInteger(creditPaise)) {
      return {
        success: false,
        error: `Line ${i + 1} contains amount exceeding safe integer range.`,
        code: "INVALID_INPUT",
      };
    }

    if (debitPaise < 0 || creditPaise < 0) {
      return {
        success: false,
        error: `Line ${i + 1} contains negative amounts, which are disallowed in double-entry vouchers.`,
        code: "INVALID_INPUT",
      };
    }

    if (debitPaise === 0 && creditPaise === 0) {
      return {
        success: false,
        error: `Line ${i + 1} has zero amount. Every line must have a positive Debit or Credit.`,
        code: "INVALID_INPUT",
      };
    }

    if (debitPaise > 0 && creditPaise > 0) {
      return {
        success: false,
        error: `Line ${i + 1} specifies both Debit and Credit. A line must be strictly Debit OR Credit.`,
        code: "INVALID_INPUT",
      };
    }

    totalDebitPaise += debitPaise;
    totalCreditPaise += creditPaise;
    referencedLedgerIds.add(rawLine.ledgerId.trim());

    processedLines.push({
      id: `line_${i + 1}_${Math.random().toString(36).substring(2, 6)}`,
      ledgerId: rawLine.ledgerId.trim(),
      debit: debitPaise,
      credit: creditPaise,
      description: rawLine.description?.trim() || "",
      partyType: rawLine.partyType,
      partyId: rawLine.partyId,
    });
  }

  // 5. Fundamental Double-Entry Invariant: Total Debit === Total Credit
  if (totalDebitPaise !== totalCreditPaise) {
    const diffPaise = Math.abs(totalDebitPaise - totalCreditPaise);
    return {
      success: false,
      error: `Double-entry balance violation: Total Debit (₹${(
        totalDebitPaise / 100
      ).toFixed(2)}) does not equal Total Credit (₹${(
        totalCreditPaise / 100
      ).toFixed(2)}). Imbalance: ₹${(diffPaise / 100).toFixed(2)}.`,
      code: "UNBALANCED_VOUCHER",
    };
  }

  if (totalDebitPaise <= 0) {
    return {
      success: false,
      error: "Voucher total must be greater than zero.",
      code: "INVALID_INPUT",
    };
  }

  // 6. Verify all referenced ledgers belong to the company & check Contra constraints
  const ledgerSnaps = await Promise.all(
    Array.from(referencedLedgerIds).map((id) =>
      db.ref(`companyData/${input.companyId}/ledgers/${id}`).once("value")
    )
  );

  const loadedLedgers: Record<string, Ledger> = {};
  for (let idx = 0; idx < ledgerSnaps.length; idx++) {
    const snap = ledgerSnaps[idx];
    const requestedId = Array.from(referencedLedgerIds)[idx];
    if (!snap.exists()) {
      return {
        success: false,
        error: `Referenced ledger '${requestedId}' does not exist in this company.`,
        code: "INVALID_INPUT",
      };
    }
    const l = snap.val() as Ledger;
    if (l.companyId !== input.companyId) {
      return {
        success: false,
        error: `Tenant violation: Ledger '${requestedId}' belongs to another company.`,
        code: "FORBIDDEN",
      };
    }
    if (l.active === false) {
      return {
        success: false,
        error: `Ledger '${l.name}' is deactivated and cannot accept new postings.`,
        code: "INVALID_INPUT",
      };
    }
    loadedLedgers[l.id] = l;
  }

  // Attach ledger names to processed lines for clarity
  for (const line of processedLines) {
    if (loadedLedgers[line.ledgerId]) {
      line.ledgerName = loadedLedgers[line.ledgerId].name;
    }
  }

  // Contra constraint: Both sides must be Cash or Bank liquidity ledgers
  if (input.voucherType === "contra") {
    for (const line of processedLines) {
      const l = loadedLedgers[line.ledgerId];
      const isLiquidity =
        l.partyType === "cash" ||
        l.partyType === "bank" ||
        l.groupId === "grp_cash" ||
        l.groupId === "grp_bank" ||
        l.groupId === "grp_cash_equiv";

      if (!isLiquidity) {
        return {
          success: false,
          error: `Contra voucher violation: Ledger '${l.name}' is not a Cash or Bank account. Contra vouchers can only transfer funds between cash and bank accounts.`,
          code: "INVALID_INPUT",
        };
      }
    }
  }

  // Payment constraint: Must credit at least one Cash, Bank, or UPI liquidity ledger (source of funds)
  if (input.voucherType === "payment") {
    const hasLiquidityCredit = processedLines.some((line) => {
      if (line.credit <= 0) return false;
      const l = loadedLedgers[line.ledgerId];
      return Boolean(
        l &&
          (l.partyType === "cash" ||
            l.partyType === "bank" ||
            l.groupId === "grp_cash" ||
            l.groupId === "grp_bank" ||
            l.groupId === "grp_cash_equiv")
      );
    });

    if (!hasLiquidityCredit) {
      return {
        success: false,
        error: "Payment voucher violation: Outgoing payment must credit at least one Cash or Bank liquidity ledger.",
        code: "INVALID_INPUT",
      };
    }
  }

  // Receipt constraint: Must debit at least one Cash, Bank, or UPI liquidity ledger (destination of funds)
  if (input.voucherType === "receipt") {
    const hasLiquidityDebit = processedLines.some((line) => {
      if (line.debit <= 0) return false;
      const l = loadedLedgers[line.ledgerId];
      return Boolean(
        l &&
          (l.partyType === "cash" ||
            l.partyType === "bank" ||
            l.groupId === "grp_cash" ||
            l.groupId === "grp_bank" ||
            l.groupId === "grp_cash_equiv")
      );
    });

    if (!hasLiquidityDebit) {
      return {
        success: false,
        error: "Receipt voucher violation: Incoming receipt must debit at least one Cash or Bank liquidity ledger.",
        code: "INVALID_INPUT",
      };
    }
  }

  // 7. Allocate Concurrency-Safe Voucher Number
  let voucherNumberInfo;
  try {
    voucherNumberInfo = await allocateVoucherNumber(
      db,
      input.companyId,
      input.financialYearId,
      fy.name,
      input.voucherType
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to allocate voucher number";
    return {
      success: false,
      error: msg,
      code: "INTERNAL_ERROR",
    };
  }

  const now = Date.now();
  const voucherId = `vouch_${now}_${Math.random().toString(36).substring(2, 7)}`;
  const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;

  const voucher: Voucher = {
    id: voucherId,
    companyId: input.companyId,
    financialYearId: input.financialYearId,
    branchId,
    voucherType: input.voucherType,
    voucherNumber: voucherNumberInfo.voucherNumber,
    date: canonicalDateStr as any,
    reference: input.reference?.trim() || "",
    narration: input.narration.trim(),
    status: "posted",
    lines: processedLines,
    totalDebit: totalDebitPaise,
    totalCredit: totalCreditPaise,
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    sourceNumber: input.sourceNumber,
    clientMutationId: input.clientMutationId.trim(),
    createdBy: callerUid,
    createdAt: now,
    postedBy: callerUid,
    postedAt: now,
  };

  // 8. Prepare Atomic Multi-Path RTDB Update
  const updates: Record<string, unknown> = {};

  // Voucher header
  updates[`companyData/${input.companyId}/vouchers/${voucherId}`] = voucher;

  // Voucher lines tree (normalized for high performance line queries)
  for (const line of processedLines) {
    updates[
      `companyData/${input.companyId}/voucherLines/${voucherId}/${line.id}`
    ] = line;
  }

  // Update Ledger current balances in integer paise
  // Standard algebraic sign: currentBalance = currentBalance + (Debit - Credit)
  for (const line of processedLines) {
    const l = loadedLedgers[line.ledgerId];
    const previousBalance = l.currentBalance || 0;
    const balanceDelta = line.debit - line.credit;
    const newBalance = previousBalance + balanceDelta;

    updates[`companyData/${input.companyId}/ledgers/${line.ledgerId}/currentBalance`] =
      newBalance;
    updates[`companyData/${input.companyId}/ledgers/${line.ledgerId}/updatedAt`] = now;
    // Update local cache copy in memory for multiple lines touching same ledger
    l.currentBalance = newBalance;
  }

  // Mutation idempotency index with payload hash
  updates[
    `companyData/${input.companyId}/voucherMutations/${input.clientMutationId}`
  ] = {
    voucherId,
    voucherNumber: voucher.voucherNumber,
    payloadHash,
    timestamp: now,
    performedBy: callerUid,
  };

  // Audit trail record
  updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
    id: auditId,
    entityType: "voucher",
    entityId: voucherId,
    action: "post",
    performedBy: callerUid,
    timestamp: now,
    newState: {
      voucherNumber: voucher.voucherNumber,
      voucherType: voucher.voucherType,
      totalAmountPaise: totalDebitPaise,
      totalAmountRupees: totalDebitPaise / 100,
      linesCount: processedLines.length,
      clientMutationId: input.clientMutationId,
    },
  };

  try {
    await db.ref().update(updates);
    return {
      success: true,
      voucher,
      voucherId,
      voucherNumber: voucher.voucherNumber,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to commit database updates";
    console.error("Failed to commit voucher posting updates:", err);
    return {
      success: false,
      error: `Failed to commit voucher posting: ${msg}`,
      code: "INTERNAL_ERROR",
    };
  }
}
