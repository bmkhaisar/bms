import { db } from "./db";

export interface HistoricalUsageResult {
  hasHistory: boolean;
  count: number;
  reason: string;
  details: {
    invoices?: number;
    purchases?: number;
    quotations?: number;
    receipts?: number;
    payments?: number;
  };
}

/**
 * Checks if a Customer, Product, Supplier, or Party has transaction history.
 * Per PRD § 6 & § 7: Entities with historical transactions must NOT be hard deleted,
 * but should be deactivated instead to preserve accounting and legal audit trails.
 */
export async function checkEntityHistoricalUsage(params: {
  entityType: "product" | "customer" | "supplier" | "party" | "category" | "unit";
  entityId: string;
}): Promise<HistoricalUsageResult> {
  if (typeof window === "undefined") {
    return { hasHistory: false, count: 0, reason: "", details: {} };
  }

  const { entityType, entityId } = params;

  try {
    if (entityType === "product") {
      let invCount = 0;
      let purCount = 0;
      let quoCount = 0;

      const invoices = await db().invoices.toArray();
      invCount = invoices.filter((inv) =>
        inv.items?.some((it) => it.productId === entityId)
      ).length;

      const purchases = await db().purchases.toArray();
      purCount = purchases.filter((pur) =>
        pur.items?.some((it) => it.productId === entityId)
      ).length;

      const quotations = await db().quotations.toArray();
      quoCount = quotations.filter((quo) =>
        quo.items?.some((it) => it.productId === entityId)
      ).length;

      const total = invCount + purCount + quoCount;
      if (total > 0) {
        const parts = [];
        if (invCount) parts.push(`${invCount} invoice(s)`);
        if (purCount) parts.push(`${purCount} purchase(s)`);
        if (quoCount) parts.push(`${quoCount} quotation(s)`);

        return {
          hasHistory: true,
          count: total,
          reason: `This product is used in ${parts.join(", ")} and cannot be permanently deleted. You can deactivate it instead.`,
          details: { invoices: invCount, purchases: purCount, quotations: quoCount },
        };
      }
    } else if (entityType === "customer" || entityType === "party") {
      let invCount = 0;
      let recCount = 0;
      let quoCount = 0;

      const invoices = await db().invoices.where("customerId").equals(entityId).count();
      invCount = invoices;

      const receipts = await db().receipts.where("customerId").equals(entityId).count();
      recCount = receipts;

      const quotations = await db().quotations.where("customerId").equals(entityId).count();
      quoCount = quotations;

      let purCount = 0;
      let payCount = 0;
      // If BOTH (Party), also check supplier transactions
      if (entityType === "party") {
        purCount = await db().purchases.where("supplierId").equals(entityId).count();
        payCount = await db().payments.where("supplierId").equals(entityId).count();
      }

      const total = invCount + recCount + quoCount + purCount + payCount;
      if (total > 0) {
        const parts = [];
        if (invCount) parts.push(`${invCount} invoice(s)`);
        if (recCount) parts.push(`${recCount} receipt(s)`);
        if (quoCount) parts.push(`${quoCount} quotation(s)`);
        if (purCount) parts.push(`${purCount} purchase(s)`);
        if (payCount) parts.push(`${payCount} payment(s)`);

        return {
          hasHistory: true,
          count: total,
          reason: `This party has ${parts.join(", ")} and cannot be permanently deleted. You can deactivate it instead.`,
          details: { invoices: invCount, receipts: recCount, quotations: quoCount, purchases: purCount, payments: payCount },
        };
      }
    } else if (entityType === "supplier") {
      const purCount = await db().purchases.where("supplierId").equals(entityId).count();
      const payCount = await db().payments.where("supplierId").equals(entityId).count();
      const total = purCount + payCount;

      if (total > 0) {
        const parts = [];
        if (purCount) parts.push(`${purCount} purchase(s)`);
        if (payCount) parts.push(`${payCount} payment(s)`);

        return {
          hasHistory: true,
          count: total,
          reason: `This supplier is referenced in ${parts.join(", ")} and cannot be permanently deleted. You can deactivate it instead.`,
          details: { purchases: purCount, payments: payCount },
        };
      }
    } else if (entityType === "category") {
      const prodCount = await db().products.where("categoryId").equals(entityId).count();
      if (prodCount > 0) {
        return {
          hasHistory: true,
          count: prodCount,
          reason: `This category has ${prodCount} product(s) assigned to it. Reassign the products before deleting.`,
          details: {},
        };
      }
    }
  } catch (err) {
    console.warn(`[HistoricalUsage] Error checking history for ${entityType}:${entityId}`, err);
  }

  return { hasHistory: false, count: 0, reason: "", details: {} };
}
