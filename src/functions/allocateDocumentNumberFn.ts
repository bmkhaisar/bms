import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { allocateLegalDocumentNumber } from "@/server/accounting/numberingEngine";

export interface AllocateDocNumberInput {
  idToken: string;
  companyId: string;
  financialYearId: string;
  docType: "invoice" | "quotation" | "receipt" | "purchase";
  fyName?: string;
  customPrefix?: string;
}

export interface AllocateDocNumberResult {
  success: boolean;
  documentNumber?: string;
  sequenceNumber?: number;
  error?: string;
  code?: string;
}

export const allocateDocumentNumberServerFn = createServerFn({ method: "POST" })
  .validator((data: AllocateDocNumberInput) => data)
  .handler(async ({ data }): Promise<AllocateDocNumberResult> => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return {
        success: false,
        error: "Server configuration required. Firebase Admin credentials missing.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }

    try {
      const decoded = await adminApp.auth().verifyIdToken(data.idToken);
      const sessionCheck = checkSessionAge(decoded);
      if (!sessionCheck.valid) {
        return {
          success: false,
          error: sessionCheck.error,
          code: sessionCheck.code,
        };
      }

      const db = adminApp.database();
      // Verify caller membership in company
      const memSnap = await db.ref(`memberships/${data.companyId}/${decoded.uid}`).once("value");
      if (!memSnap.exists() || memSnap.val().status !== "active") {
        return {
          success: false,
          error: "Forbidden: Caller is not an active member of this company.",
          code: "FORBIDDEN",
        };
      }

      const result = await allocateLegalDocumentNumber(db, {
        companyId: data.companyId,
        financialYearId: data.financialYearId,
        docType: data.docType,
        fyName: data.fyName,
        customPrefix: data.customPrefix,
      });

      return {
        success: true,
        documentNumber: result.documentNumber,
        sequenceNumber: result.sequenceNumber,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to allocate document number";
      return {
        success: false,
        error: msg,
      };
    }
  });
