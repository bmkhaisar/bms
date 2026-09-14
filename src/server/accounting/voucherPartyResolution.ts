import type { Ledger, VoucherPartyType } from "@/modules/accounting/types";

interface CanonicalPartyRecord {
  id?: string;
  partyType?: string;
}

const DEBTOR_TYPES = new Set(["SUNDRY_DEBTOR", "SUNDRY_DEBTORS", "CUSTOMER", "BOTH"]);
const CREDITOR_TYPES = new Set(["SUNDRY_CREDITOR", "SUNDRY_CREDITORS", "SUPPLIER", "BOTH"]);

export class VoucherPartyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VoucherPartyValidationError";
  }
}

export function requiredPartyTypeForLedger(ledger: Pick<Ledger, "groupId" | "partyType">): VoucherPartyType | undefined {
  if (ledger.groupId === "grp_sundry_debtors" || ledger.partyType === "customer") return "SUNDRY_DEBTOR";
  if (ledger.groupId === "grp_sundry_creditors" || ledger.partyType === "supplier") return "SUNDRY_CREDITOR";
  return undefined;
}

export function resolveVoucherPartyMetadata(params: {
  lineNumber: number;
  requestedPartyId?: string;
  ledger: Pick<Ledger, "id" | "name" | "groupId" | "partyType" | "partyId">;
  party?: CanonicalPartyRecord | null;
}): { partyId?: string; partyType?: VoucherPartyType } {
  const { lineNumber, ledger, party } = params;
  const requiredType = requiredPartyTypeForLedger(ledger);
  const partyId = params.requestedPartyId?.trim() || ledger.partyId?.trim();

  if (!partyId) {
    if (requiredType) {
      throw new VoucherPartyValidationError(
        `Line ${lineNumber} uses party ledger '${ledger.name}' but has no canonical Party Master partyId.`,
      );
    }
    return {};
  }

  if (!party || party.id !== partyId) {
    throw new VoucherPartyValidationError(
      `Line ${lineNumber} references Party '${partyId}', but that canonical Party Master record does not exist in this company.`,
    );
  }

  const rawPartyType = String(party.partyType || "").trim().toUpperCase();
  const resolvedType = requiredType || (DEBTOR_TYPES.has(rawPartyType)
    ? "SUNDRY_DEBTOR"
    : CREDITOR_TYPES.has(rawPartyType)
      ? "SUNDRY_CREDITOR"
      : undefined);

  if (!resolvedType) {
    throw new VoucherPartyValidationError(
      `Line ${lineNumber} references Party '${partyId}' with an invalid or unsupported Party Master type.`,
    );
  }
  const allowed = resolvedType === "SUNDRY_DEBTOR"
    ? DEBTOR_TYPES.has(rawPartyType)
    : CREDITOR_TYPES.has(rawPartyType);
  if (!allowed) {
    throw new VoucherPartyValidationError(
      `Line ${lineNumber} requires ${resolvedType}, but Party '${partyId}' has incompatible Party Master type '${rawPartyType || "MISSING"}'.`,
    );
  }

  return { partyId, partyType: resolvedType };
}
