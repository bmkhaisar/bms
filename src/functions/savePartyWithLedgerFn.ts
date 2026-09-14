import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { allocatePartyBusinessCode } from "@/server/accounting/numberingEngine";

interface Input {
  idToken: string;
  companyId: string;
  party: Record<string, any>;
  idempotencyKey?: string;
}

const clean = (value: any): any => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clean);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
};

export const savePartyWithLedgerServerFn = createServerFn({ method: "POST" })
  .validator((data: Input) => data)
  .handler(async ({ data }) => {
    const app = getFirebaseAdmin();
    if (!app) return { success: false as const, code: "SERVER_CONFIG_REQUIRED", error: "Server configuration required." };
    try {
      const decoded = await app.auth().verifyIdToken(data.idToken);
      const session = checkSessionAge(decoded);
      if (!session.valid) return { success: false as const, code: session.code, error: session.error };
      const db = app.database();
      const membership = await db.ref(`memberships/${data.companyId}/${decoded.uid}`).once("value");
      if (!membership.exists() || membership.val().status !== "active") {
        return { success: false as const, code: "FORBIDDEN", error: "Active company membership required." };
      }

      if (data.idempotencyKey) {
        const prior = await db.ref(`companyData/${data.companyId}/partyMutations/${data.idempotencyKey}`).once("value");
        if (prior.exists()) {
          const existing = await db.ref(`companyData/${data.companyId}/parties/${prior.val().partyId}`).once("value");
          if (existing.exists()) {
            const party = existing.val();
            return { success: true as const, party, ledgerId: party.ledgerId, apLedgerId: party.apLedgerId, isExisting: true };
          }
        }
      }

      const partyType = data.party.partyType || "SUNDRY_DEBTOR";
      const isCustomer = ["CUSTOMER", "SUNDRY_DEBTOR", "SUNDRY_DEBTORS", "BOTH"].includes(partyType);
      const isSupplier = ["SUPPLIER", "SUNDRY_CREDITOR", "SUNDRY_CREDITORS", "BOTH"].includes(partyType);
      const kind = isSupplier && !isCustomer ? "supplier" : "customer";
      const partyCode = data.party.partyCode || await allocatePartyBusinessCode(db, { companyId: data.companyId, partyId: data.party.id, kind });
      const now = Date.now();
      const openingPaise = Math.round(Number(data.party.openingBalance || 0) * 100);
      const ledgerName = data.party.tradingName || data.party.name;
      const arId = isCustomer ? (data.party.ledgerId || `led_${data.companyId}_ar_${data.party.id}`) : undefined;
      const apId = isSupplier ? (data.party.apLedgerId || `led_${data.companyId}_ap_${data.party.id}`) : undefined;
      const party = clean({ ...data.party, partyCode, ledgerId: arId, apLedgerId: apId, createdAt: data.party.createdAt || now, updatedAt: now });
      const updates: Record<string, any> = {
        [`companyData/${data.companyId}/parties/${party.id}`]: party,
      };
      if (arId) updates[`companyData/${data.companyId}/ledgers/${arId}`] = clean({
        id: arId, companyId: data.companyId, name: ledgerName, groupId: "grp_sundry_debtors", groupNature: "asset",
        openingBalance: Math.abs(openingPaise), openingBalanceType: openingPaise < 0 ? "cr" : "dr", currentBalance: openingPaise,
        currency: "INR", gstin: party.gstin, partyType: "customer", partyId: party.id, active: true,
        createdAt: party.createdAt, updatedAt: now,
      });
      if (apId) updates[`companyData/${data.companyId}/ledgers/${apId}`] = clean({
        id: apId, companyId: data.companyId, name: ledgerName, groupId: "grp_sundry_creditors", groupNature: "liability",
        openingBalance: Math.abs(openingPaise), openingBalanceType: openingPaise < 0 ? "dr" : "cr", currentBalance: -Math.abs(openingPaise),
        currency: "INR", gstin: party.gstin, partyType: "supplier", partyId: party.id, active: true,
        createdAt: party.createdAt, updatedAt: now,
      });
      const auditId = `audit_${now}_${party.id}`;
      updates[`companyData/${data.companyId}/auditLogs/${auditId}`] = clean({
        id: auditId, entityType: "party", entityId: party.id, action: "save_party_with_ledger",
        performedBy: decoded.uid, timestamp: now, details: { partyCode, partyType, arLedgerId: arId, apLedgerId: apId },
      });
      if (data.idempotencyKey) updates[`companyData/${data.companyId}/partyMutations/${data.idempotencyKey}`] = {
        partyId: party.id, partyCode, timestamp: now, performedBy: decoded.uid,
      };
      await db.ref().update(updates);
      return { success: true as const, party, ledgerId: arId, apLedgerId: apId, isExisting: false };
    } catch (error) {
      return { success: false as const, code: "PARTY_SAVE_FAILED", error: error instanceof Error ? error.message : String(error) };
    }
  });
