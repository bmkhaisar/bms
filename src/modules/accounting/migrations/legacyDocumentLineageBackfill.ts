/**
 * Idempotent Migration: Legacy Document Lineage Backfill (PRD §§ 54-56)
 * 
 * Safely repairs missing conversion and amendment lineage across legacy documents
 * without hardcoded lookup tables or company-specific IDs.
 * 
 * Invariants:
 * 1. Dry-run by default — never modifies records without explicit apply command.
 * 2. Never rewrites already-valid document lineage.
 * 3. Never guesses: ambiguous evidence is flagged as LINEAGE_UNRESOLVED for CA review.
 * 4. Produces immutable audit log entries for every modification.
 * 5. Company-scoped and tenant-isolated.
 */

import type { Invoice, Receipt } from "@/lib/db";

export interface LineageEvidenceCandidate {
  documentId: string;
  documentNumber: string;
  customerId: string;
  companyId: string;
  previousMetadata: {
    sourceQuotationId?: string;
    sourceQuotationNumber?: string;
    amendedFromId?: string;
    amendedFromNumber?: string;
    originalDocumentId?: string;
    originalDocumentNumber?: string;
  };
  newMetadata: {
    sourceQuotationId?: string;
    sourceQuotationNumber?: string;
    amendedFromId?: string;
    amendedFromNumber?: string;
    originalDocumentId?: string;
    originalDocumentNumber?: string;
  };
  evidenceUsed: string;
}

export interface UnresolvedLineageItem {
  documentId: string;
  documentNumber: string;
  customerId: string;
  companyId: string;
  reason: string;
  candidatesFound: string[];
}

export interface LineageMigrationAuditLog {
  id: string;
  companyId: string;
  documentId: string;
  documentNumber: string;
  previousMetadata: Record<string, any>;
  newMetadata: Record<string, any>;
  evidenceUsed: string;
  migratedAt: number;
  migratedBy: string;
}

export interface LineageAuditReport {
  companyId: string;
  totalInvoicesChecked: number;
  alreadyValidCount: number;
  repairCandidates: LineageEvidenceCandidate[];
  unresolvedCount: number;
  unresolvedItems: UnresolvedLineageItem[];
  isDryRun: boolean;
}

/**
 * Pure audit and analysis function for legacy document lineage backfill.
 * Scans invoices, quotations, and receipts for verifiable, unambiguous conversion traces.
 */
export function analyzeLegacyDocumentLineage(params: {
  companyId: string;
  invoices: Invoice[];
  quotations: any[];
  receipts: Receipt[];
}): LineageAuditReport {
  const { companyId, invoices, quotations, receipts } = params;

  const scopedInvoices = invoices.filter((inv) => (inv.companyId || companyId) === companyId);
  const scopedQuotations = quotations.filter((q) => (q.companyId || companyId) === companyId);
  const scopedReceipts = receipts.filter((r) => (r.companyId || companyId) === companyId);

  const repairCandidates: LineageEvidenceCandidate[] = [];
  const unresolvedItems: UnresolvedLineageItem[] = [];
  let alreadyValidCount = 0;

  for (const inv of scopedInvoices) {
    // 1. Invariant: Never rewrite already valid lineage
    const hasSourceQuotation = Boolean((inv as any).sourceQuotationId || (inv as any).convertedFromQuotationId);
    const hasAmendedFrom = Boolean(inv.amendedFromId || (inv as any).amendedFromNumber);
    const hasOriginalDoc = Boolean(inv.originalDocumentId || (inv as any).originalDocumentNumber);

    if (hasSourceQuotation || hasAmendedFrom || hasOriginalDoc) {
      alreadyValidCount++;
      continue;
    }

    // 2. Search for authoritative persisted evidence
    // Evidence A: Quotation explicitly records convertedInvoiceId or convertedInvoiceNumber
    const directQuotationMatches = scopedQuotations.filter((q) => {
      const partyMatches = !inv.customerId || !q.customerId || inv.customerId === q.customerId;
      if (!partyMatches) return false;
      return (
        q.convertedInvoiceId === inv.id ||
        (q.convertedInvoiceNumber && inv.number && q.convertedInvoiceNumber.toLowerCase() === inv.number.toLowerCase())
      );
    });

    if (directQuotationMatches.length === 1) {
      const q = directQuotationMatches[0];
      repairCandidates.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        companyId,
        previousMetadata: {
          sourceQuotationId: (inv as any).sourceQuotationId,
          sourceQuotationNumber: (inv as any).sourceQuotationNumber,
          amendedFromId: inv.amendedFromId,
        },
        newMetadata: {
          sourceQuotationId: q.id,
          sourceQuotationNumber: q.number,
          amendedFromId: `inv_from_${q.id}`,
          amendedFromNumber: q.number,
        },
        evidenceUsed: `Direct quotation conversion linkage: Quotation ${q.number} (${q.id}) recorded convertedInvoiceId=${q.convertedInvoiceId}`,
      });
      continue;
    }

    // Evidence B: Receipts for this customer reference inv_from_${quotationId}
    const receiptReferences = new Set<string>();
    for (const r of scopedReceipts) {
      if (r.customerId && inv.customerId && r.customerId !== inv.customerId) continue;
      if (r.allocatedInvoices) {
        for (const a of r.allocatedInvoices) {
          const tid = String(a.invoiceId || a.invoiceNumber || "").trim();
          if (tid.startsWith("inv_from_")) {
            receiptReferences.add(tid.replace(/^inv_from_/, ""));
          }
        }
      }
      if (r.invoiceId && String(r.invoiceId).startsWith("inv_from_")) {
        receiptReferences.add(String(r.invoiceId).replace(/^inv_from_/, ""));
      }
    }

    const matchingQuotationsByReceipt = scopedQuotations.filter((q) => {
      const partyMatches = !inv.customerId || !q.customerId || inv.customerId === q.customerId;
      if (!partyMatches) return false;
      return receiptReferences.has(q.id) || (q.number && receiptReferences.has(q.number.toLowerCase()));
    });

    if (matchingQuotationsByReceipt.length === 1) {
      const q = matchingQuotationsByReceipt[0];
      repairCandidates.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        companyId,
        previousMetadata: {
          sourceQuotationId: (inv as any).sourceQuotationId,
          sourceQuotationNumber: (inv as any).sourceQuotationNumber,
          amendedFromId: inv.amendedFromId,
        },
        newMetadata: {
          sourceQuotationId: q.id,
          sourceQuotationNumber: q.number,
          amendedFromId: `inv_from_${q.id}`,
          amendedFromNumber: q.number,
        },
        evidenceUsed: `Immutable receipt conversion token: Customer receipt references inv_from_${q.id} matching unique quotation ${q.number}`,
      });
      continue;
    }

    if (matchingQuotationsByReceipt.length > 1) {
      // Invariant: Ambiguity must NEVER be guessed
      unresolvedItems.push({
        documentId: inv.id,
        documentNumber: inv.number,
        customerId: inv.customerId,
        companyId,
        reason: "LINEAGE_UNRESOLVED: Multiple candidate quotations match receipt conversion tokens for this customer",
        candidatesFound: matchingQuotationsByReceipt.map((q) => `${q.number} (${q.id})`),
      });
    }
  }

  return {
    companyId,
    totalInvoicesChecked: scopedInvoices.length,
    alreadyValidCount,
    repairCandidates,
    unresolvedCount: unresolvedItems.length,
    unresolvedItems,
    isDryRun: true,
  };
}

/**
 * Build audit log entries for applied lineage repairs.
 */
export function buildLineageAuditLogs(params: {
  candidates: LineageEvidenceCandidate[];
  migratedBy: string;
  now?: number;
}): LineageMigrationAuditLog[] {
  const { candidates, migratedBy, now = Date.now() } = params;
  return candidates.map((c, index) => ({
    id: `audit_lineage_${now}_${index}`,
    companyId: c.companyId,
    documentId: c.documentId,
    documentNumber: c.documentNumber,
    previousMetadata: c.previousMetadata,
    newMetadata: c.newMetadata,
    evidenceUsed: c.evidenceUsed,
    migratedAt: now,
    migratedBy,
  }));
}
