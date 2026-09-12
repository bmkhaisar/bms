import { allocateDocumentNumberServerFn } from "@/functions/allocateDocumentNumberFn";
import { nextNumber } from "@/lib/db";

export interface GetNextDocNumberParams {
  kind: "invoice" | "quotation" | "receipt" | "purchase";
  companyId?: string;
  financialYearId?: string;
  fyName?: string;
  idToken?: string;
  customPrefix?: string;
}

/**
 * Concurrency-Safe Legal Document Number Allocator Client.
 * Queries the authoritative server-side RTDB atomic transaction counter.
 * Falls back safely to local monotonic sequence if running offline.
 */
export async function getNextDocumentNumber(
  params: GetNextDocNumberParams
): Promise<string> {
  const { kind, companyId, financialYearId, fyName, idToken, customPrefix } = params;

  if (idToken && companyId && financialYearId) {
    try {
      const res = await allocateDocumentNumberServerFn({
        data: {
          idToken,
          companyId,
          financialYearId,
          docType: kind,
          fyName,
          customPrefix,
        },
      });

      if (res.success && res.documentNumber) {
        return res.documentNumber;
      }
    } catch (err) {
      console.warn("Server document number allocation error, falling back to local:", err);
    }
  }

  // Local fallback
  return await nextNumber(kind);
}
