import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { ensureCompanyChartOfAccounts, type InitChartOfAccountsResult } from "@/server/accounting/initChartOfAccounts";

export interface InitChartInput {
  idToken: string;
  companyId: string;
}

/**
 * Server Function RPC to ensure Chart of Accounts exists for a company.
 */
export const initChartOfAccountsServerFn = createServerFn({ method: "POST" })
  .validator((data: InitChartInput) => data)
  .handler(async ({ data }): Promise<InitChartOfAccountsResult> => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return {
        success: false,
        groupsCreated: 0,
        ledgersCreated: 0,
        error: "Server configuration required.",
      };
    }
    if (!data.idToken || !data.companyId) {
      return {
        success: false,
        groupsCreated: 0,
        ledgersCreated: 0,
        error: "Token and companyId required.",
      };
    }
    let decoded;
    try {
      decoded = await adminApp.auth().verifyIdToken(data.idToken);
    } catch {
      return {
        success: false,
        groupsCreated: 0,
        ledgersCreated: 0,
        error: "Unauthorized token.",
      };
    }
    const db = adminApp.database();
    return await ensureCompanyChartOfAccounts(db, data.companyId, decoded.uid);
  });
