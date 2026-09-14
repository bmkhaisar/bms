import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";

interface Input { idToken: string; companyId: string }

/** Repairs a missing current financial year once, on the trusted server, without replacing existing years. */
export const ensureActiveFinancialYearServerFn = createServerFn({ method: "POST" })
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

      const [companySnap, yearsSnap] = await Promise.all([
        adminDb.ref(`companies/${data.companyId}`).once("value"),
        adminDb.ref(`companyData/${data.companyId}/financialYears`).once("value"),
      ]);
      if (!companySnap.exists()) return { success: false as const, error: "Company not found." };
      const company = companySnap.val();
      const years: Record<string, any> = yearsSnap.val() || {};
      if (company.currentFinancialYearId && years[company.currentFinancialYearId]) {
        return { success: true as const, financialYear: years[company.currentFinancialYearId], repaired: false };
      }

      const now = new Date();
      const year = now.getUTCMonth() >= 3 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      const startDate = Date.UTC(year, 3, 1);
      const endDate = Date.UTC(year + 1, 2, 31, 23, 59, 59, 999);
      const existing = Object.values(years).find((fy: any) => Number(fy.startDate) <= now.getTime() && Number(fy.endDate) >= now.getTime());
      const financialYear = existing || {
        id: `fy_${year}_${year + 1}`,
        name: `${year}-${year + 1}`,
        startDate,
        endDate,
        locked: false,
        createdAt: Date.now(),
      };
      const auditId = `audit_${Date.now()}_financial_year_repair`;
      await adminDb.ref().update({
        [`companyData/${data.companyId}/financialYears/${financialYear.id}`]: financialYear,
        [`companies/${data.companyId}/currentFinancialYearId`]: financialYear.id,
        [`companyData/${data.companyId}/auditLogs/${auditId}`]: {
          id: auditId, entityType: "financialYear", entityId: financialYear.id, action: "ensure_current_financial_year",
          performedBy: decoded.uid, timestamp: Date.now(), details: { created: !existing },
        },
      });
      return { success: true as const, financialYear, repaired: true };
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
