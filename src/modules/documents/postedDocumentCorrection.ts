import type { Invoice, Purchase } from "@/lib/db";

export type CorrectablePostedDocument = Invoice | Purchase;

export function isPostedFinancialDocument(document: CorrectablePostedDocument): boolean {
  if (document.postingStatus === "reversed" || document.status === "voided" || document.status === "cancelled") return false;
  return document.postingStatus === "posted" || Boolean(document.voucherId);
}

/**
 * Creates a separate correction draft. A posted financial document is never
 * reused as the editor model, so its immutable accounting identity cannot be
 * overwritten by the normal draft-save path.
 */
export function createPostedDocumentCorrectionDraft<T extends CorrectablePostedDocument>(params: {
  original: T;
  replacementId: string;
  replacementNumber: string;
  reason: string;
  now?: number;
}): T {
  const { original, replacementId, replacementNumber } = params;
  const reason = params.reason.trim();
  if (!isPostedFinancialDocument(original)) {
    throw new Error("Only a posted financial document can enter the correction workflow.");
  }
  if (!reason) throw new Error("A correction reason is required for the audit trail.");
  if (replacementId === original.id) {
    throw new Error("A correction must use a new immutable document ID.");
  }

  const now = params.now ?? Date.now();
  const draft = {
    ...original,
    id: replacementId,
    number: replacementNumber,
    status: "draft",
    postingStatus: "draft",
    voucherId: undefined,
    amountPaid: 0,
    balance: original.grandTotal,
    amendedFromId: original.id,
    originalDocumentId: original.id,
    correctionReason: reason,
    reversalVoucherId: undefined,
    createdAt: now,
    updatedAt: now,
    version: (original.version || 1) + 1,
  } as T;

  return draft;
}

export function assertPostedDocumentNotDirectlyMutable(
  original: CorrectablePostedDocument | undefined,
  submitted: CorrectablePostedDocument,
): void {
  if (original && isPostedFinancialDocument(original) && submitted.id === original.id) {
    throw new Error(
      `Posted ${"customerId" in submitted ? "invoice" : "purchase"} ${original.number} is immutable. Use Correct Posted ${
        "customerId" in submitted ? "Invoice" : "Purchase"
      } to preserve ledger, GST, stock, and audit history.`,
    );
  }
}
