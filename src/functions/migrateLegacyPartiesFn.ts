import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { allocatePartyBusinessCode } from "@/server/accounting/numberingEngine";

interface Input { idToken: string; companyId: string }

const clean = (value: any): any => {
  if (value === undefined) return null;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clean);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, clean(v)]));
};

/** Server-authoritative, repeatable migration. Same-name parties remain distinct; only IDs and GSTINs are identity keys. */
export const migrateLegacyPartiesServerFn = createServerFn({ method: "POST" })
  .validator((data: Input) => data)
  .handler(async ({ data }) => {
    const app = getFirebaseAdmin();
    if (!app) return { success: false as const, error: "Server configuration required." };
    try {
      const decoded = await app.auth().verifyIdToken(data.idToken);
      const session = checkSessionAge(decoded);
      if (!session.valid) return { success: false as const, error: session.error };
      const adminDb = app.database();
      const membership = await adminDb.ref(`memberships/${data.companyId}/${decoded.uid}`).once("value");
      if (!membership.exists() || membership.val().status !== "active") {
        return { success: false as const, error: "Active company membership required." };
      }

      const root = `companyData/${data.companyId}`;
      const [partiesSnap, customersSnap, suppliersSnap, mappingsSnap] = await Promise.all([
        adminDb.ref(`${root}/parties`).once("value"),
        adminDb.ref(`${root}/customers`).once("value"),
        adminDb.ref(`${root}/suppliers`).once("value"),
        adminDb.ref(`${root}/legacyPartyMappings`).once("value"),
      ]);
      const parties: Record<string, any> = partiesSnap.val() || {};
      const customers: Record<string, any> = customersSnap.val() || {};
      const suppliers: Record<string, any> = suppliersSnap.val() || {};
      const mappings: Record<string, string> = mappingsSnap.val() || {};
      const byGstin = new Map<string, string>();
      Object.values(parties).forEach((party: any) => {
        const gstin = String(party.gstin || "").trim().toUpperCase();
        if (gstin) byGstin.set(gstin, party.id);
      });

      const updates: Record<string, any> = {};
      const now = Date.now();
      let migratedCount = 0;
      const migrate = async (legacy: any, kind: "customer" | "supplier") => {
        const mappingKey = `${kind}_${legacy.id}`;
        let partyId = mappings[mappingKey] || (parties[legacy.id] ? legacy.id : "");
        const gstin = String(legacy.gstin || "").trim().toUpperCase();
        if (!partyId && gstin) partyId = byGstin.get(gstin) || "";
        if (!partyId) partyId = legacy.id;

        const current = parties[partyId] || {};
        const customer = kind === "customer";
        const alreadyCustomer = ["SUNDRY_DEBTOR", "SUNDRY_DEBTORS", "CUSTOMER", "BOTH"].includes(current.partyType);
        const alreadySupplier = ["SUNDRY_CREDITOR", "SUNDRY_CREDITORS", "SUPPLIER", "BOTH"].includes(current.partyType);
        const partyType = (customer && alreadySupplier) || (!customer && alreadyCustomer)
          ? "BOTH"
          : customer ? "SUNDRY_DEBTOR" : "SUNDRY_CREDITOR";
        const partyCode = current.partyCode || await allocatePartyBusinessCode(adminDb, {
          companyId: data.companyId, partyId, kind: customer ? "customer" : "supplier",
        });
        const arId = customer || alreadyCustomer ? (current.ledgerId || `led_${data.companyId}_ar_${partyId}`) : current.ledgerId;
        const apId = !customer || alreadySupplier ? (current.apLedgerId || `led_${data.companyId}_ap_${partyId}`) : current.apLedgerId;
        const openingPaise = Math.round(Number(legacy.openingBalance || current.openingBalance || 0) * 100);
        const party = clean({
          ...legacy, ...current, id: partyId, partyCode, partyType, ledgerId: arId, apLedgerId: apId,
          name: current.name || legacy.name || "Unnamed Party", country: current.country || legacy.country || "India",
          pincode: current.pincode || legacy.pincode || "000000", openingBalance: Number(current.openingBalance ?? legacy.openingBalance ?? 0),
          createdAt: current.createdAt || legacy.createdAt || now, updatedAt: now,
        });
        parties[partyId] = party;
        if (gstin) byGstin.set(gstin, partyId);
        updates[`${root}/parties/${partyId}`] = party;
        updates[`${root}/legacyPartyMappings/${mappingKey}`] = partyId;
        if (arId && !current.ledgerId) updates[`${root}/ledgers/${arId}`] = clean({
          id: arId, companyId: data.companyId, name: party.tradingName || party.name, groupId: "grp_sundry_debtors",
          groupNature: "asset", openingBalance: Math.abs(openingPaise), openingBalanceType: openingPaise < 0 ? "cr" : "dr",
          currentBalance: openingPaise, currency: "INR", partyType: "customer", partyId, active: true, createdAt: now, updatedAt: now,
        });
        if (apId && !current.apLedgerId) updates[`${root}/ledgers/${apId}`] = clean({
          id: apId, companyId: data.companyId, name: party.tradingName || party.name, groupId: "grp_sundry_creditors",
          groupNature: "liability", openingBalance: Math.abs(openingPaise), openingBalanceType: openingPaise < 0 ? "dr" : "cr",
          currentBalance: -Math.abs(openingPaise), currency: "INR", partyType: "supplier", partyId, active: true, createdAt: now, updatedAt: now,
        });
        if (!current.id) migratedCount += 1;
        return partyId;
      };

      const idMap = new Map<string, string>();
      for (const legacy of Object.values(customers)) idMap.set(`customer:${(legacy as any).id}`, await migrate(legacy, "customer"));
      for (const legacy of Object.values(suppliers)) idMap.set(`supplier:${(legacy as any).id}`, await migrate(legacy, "supplier"));

      // Rewrite live foreign keys while frozen snapshots stay unchanged for historical rendering.
      const rels = [
        ["invoices", "customerId", "customer"], ["quotations", "customerId", "customer"],
        ["receipts", "customerId", "customer"], ["purchases", "supplierId", "supplier"],
        ["payments", "supplierId", "supplier"],
      ] as const;
      for (const [collection, field, kind] of rels) {
        const snap = await adminDb.ref(`${root}/${collection}`).once("value");
        const records = snap.val() || {};
        for (const [recordId, record] of Object.entries(records) as [string, any][]) {
          const mapped = idMap.get(`${kind}:${record[field]}`);
          if (mapped && mapped !== record[field]) updates[`${root}/${collection}/${recordId}/${field}`] = mapped;
        }
      }
      const auditId = `audit_${now}_legacy_party_migration`;
      updates[`${root}/auditLogs/${auditId}`] = {
        id: auditId, entityType: "party", action: "legacy_party_migration", performedBy: decoded.uid,
        timestamp: now, details: { customers: Object.keys(customers).length, suppliers: Object.keys(suppliers).length, migratedCount },
      };
      if (Object.keys(updates).length) await adminDb.ref().update(updates);
      return { success: true as const, migratedCount, parties: Object.values(parties), partiesCount: Object.keys(parties).length };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
