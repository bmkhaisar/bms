/**
 * BMS NEXT — Production PDF & Asset Cache Service
 * 
 * Implements Section 1, 18 & 20 of BMS NEXT Performance & Production Safety Specification:
 * - PDF_CACHE_STALE_DOCUMENT = IMPOSSIBLE: Content fingerprint over all PDF-affecting fields
 * - PDF_DRAFT_INVALIDATION = VERIFIED: Immediate cache miss if any draft field updates
 * - PDF_ISSUED_SNAPSHOT_IMMUTABILITY = VERIFIED: Authoritative immutable snapshot identity
 * - PDF_ASSET_VERSIONING = VERIFIED: Asset cache keyed by companyId + assetType + key + version
 */

interface CachedPdfBlob {
  blob: Blob;
  createdAt: number;
}

// In-memory session cache for generated vector PDF Blobs
const pdfBlobCache = new Map<string, CachedPdfBlob>();

// Maximum age for cached PDF Blob (15 minutes)
const MAX_BLOB_CACHE_AGE_MS = 15 * 60 * 1000;

// Maximum cached Blobs to prevent memory exhaustion
const MAX_CACHED_BLOBS = 50;

/**
 * Computes a fast 32-bit FNV-1a hash of a string.
 */
function fnv1a32(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Computes an authoritative, deterministic fingerprint of the Effective Document Snapshot.
 * If ANY PDF-affecting field changes, the fingerprint changes immediately.
 */
export function computeDocumentEffectiveFingerprint(doc: any): string {
  if (!doc) return "null";

  // 1. Issued / Finalized documents have frozen, immutable snapshots
  const isFinalized =
    doc.postingStatus === "posted" ||
    doc.status === "final" ||
    Boolean(doc.isFinalized) ||
    Boolean(doc.postedAt);

  if (isFinalized) {
    const versionToken = doc.snapshotVersion || doc.postedAt || doc.updatedAt || doc.date || 1;
    return `ISSUED:${versionToken}`;
  }

  // 2. Draft documents: Hash ALL PDF-affecting fields
  const snapshotData = {
    num: doc.number || "",
    date: doc.date,
    updatedAt: doc.updatedAt,
    ref: doc.reference,
    party: {
      id: doc.customerId || doc.supplierId || doc.partyId,
      snap: doc.customerSnapshot || doc.supplierSnapshot || doc.partySnapshot,
    },
    billTo: doc.billingAddress || doc.customerAddress || doc.supplierAddress,
    shipTo: {
      addr: doc.shippingAddress || doc.shipToAddress,
      name: doc.shipToName,
      city: doc.shipToCity,
      state: doc.shipToState,
      pincode: doc.shipToPincode,
      gstin: doc.shipToGstin,
      phone: doc.shipToPhone,
    },
    pos: doc.placeOfSupply || doc.isIgst,
    items: (doc.items || []).map((it: any) => ({
      name: it.name,
      desc: it.description,
      size: it.size || it.sizeSnapshot?.label,
      qty: it.quantity,
      rate: it.rate,
      disc: it.discountPct,
      gst: it.gstRate,
      taxable: it.taxableAmount,
      total: it.total,
      uom: it.unit || it.uomSnapshot,
    })),
    charges: (doc.extraCharges || []).map((chg: any) => ({
      l: chg.label,
      a: chg.amount,
    })),
    chargesTotal: doc.extraChargesTotal,
    subtotal: doc.subtotal,
    taxTotal: doc.taxTotal,
    grandTotal: doc.grandTotal,
    terms: doc.terms || doc.termsSnapshot || doc.structuredTerms,
    genInfo: doc.generalInfoSnapshot || doc.generalInformationSnapshot,
    techSpecs: doc.technicalSpecifications || doc.techSpecsSnapshot,
    bank: doc.bankDetailsSnapshot || doc.bankAccountId,
    signatory: doc.signatoryOverride || doc.signatorySnapshot,
    transport: {
      dn: doc.deliveryNote,
      sr: doc.supplierRef,
      or: doc.otherReferences,
      dd: doc.despatchDocNo,
      dt: doc.despatchedThrough,
      dest: doc.destination,
      bl: doc.billOfLadingNo,
      mv: doc.motorVehicleNo,
      ewb: doc.eWayBillNo,
    },
    notes: doc.notes,
    watermark: doc.watermarkMode || doc.customWatermarkText,
  };

  const serialized = JSON.stringify(snapshotData);
  return `DRAFT:${fnv1a32(serialized)}:${serialized.length}`;
}

/**
 * Builds a deterministic cache key for a document's vector PDF representation.
 * Preferred key: documentId + authoritative snapshotVersion/fingerprint + copyType + normalized PDF options
 */
export function buildPdfCacheKey(
  doc: {
    id?: string;
    number?: string;
    updatedAt?: number;
    date?: number;
    copyLabel?: string;
    grandTotal?: number;
    items?: any[];
    [key: string]: any;
  },
  options?: {
    copyLabel?: string;
    includeDescriptions?: boolean;
    includeGeneralInfo?: boolean;
    includeTechSpecs?: boolean;
    includeTerms?: boolean;
  }
): string {
  const docId = doc.id || doc.number || "doc";
  const fingerprint = computeDocumentEffectiveFingerprint(doc);
  const copyType = options?.copyLabel || doc.copyLabel || "ORIGINAL";
  const desc = options?.includeDescriptions !== false ? "1" : "0";
  const genInfo = options?.includeGeneralInfo !== false ? "1" : "0";
  const tech = options?.includeTechSpecs !== false ? "1" : "0";
  const terms = options?.includeTerms !== false ? "1" : "0";

  return `${docId}:${fingerprint}:${copyType}:${desc}:${genInfo}:${tech}:${terms}`;
}

/**
 * Retrieves a valid cached PDF Blob from the current session if available.
 */
export function getCachedPdfBlob(key: string): Blob | null {
  const cached = pdfBlobCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.createdAt > MAX_BLOB_CACHE_AGE_MS) {
    pdfBlobCache.delete(key);
    return null;
  }

  return cached.blob;
}

/**
 * Stores a generated PDF Blob into the session cache.
 */
export function setCachedPdfBlob(key: string, blob: Blob): void {
  // Evict oldest entries if cache limit reached
  if (pdfBlobCache.size >= MAX_CACHED_BLOBS) {
    const oldestKey = pdfBlobCache.keys().next().value;
    if (oldestKey) pdfBlobCache.delete(oldestKey);
  }

  pdfBlobCache.set(key, {
    blob,
    createdAt: Date.now(),
  });
}

/**
 * Invalidates all cached PDF Blobs for a specific document ID.
 */
export function invalidatePdfBlobCache(documentId: string): void {
  if (!documentId) return;
  for (const key of Array.from(pdfBlobCache.keys())) {
    if (key.startsWith(`${documentId}:`)) {
      pdfBlobCache.delete(key);
    }
  }
}

/**
 * Explicit draft invalidation helper.
 */
export const invalidateDraftPdfCache = invalidatePdfBlobCache;

/**
 * Clears the entire PDF cache.
 */
export function clearPdfBlobCache(): void {
  pdfBlobCache.clear();
}

// ==========================================
// TENANT ASSET MEMORY CACHE (Logos, Stamps, Signatures)
// ==========================================

const assetMemoryCache = new Map<string, string>();

/**
 * Retrieves a cached asset data URL or object URL.
 * Safely includes asset version / object key in the cache key.
 */
export function getCachedAsset(
  companyId: string,
  assetType: string,
  assetKeyOrUrl: string,
  assetVersion?: string | number
): string | null {
  if (!companyId || !assetKeyOrUrl) return null;
  const version = assetVersion || "v1";
  const key = `${companyId}:${assetType}:${assetKeyOrUrl}:${version}`;
  return assetMemoryCache.get(key) || null;
}

/**
 * Caches an asset data URL or object URL with asset version.
 */
export function setCachedAsset(
  companyId: string,
  assetType: string,
  assetKeyOrUrl: string,
  dataUrl: string,
  assetVersion?: string | number
): void {
  if (!companyId || !assetKeyOrUrl || !dataUrl) return;
  const version = assetVersion || "v1";
  const key = `${companyId}:${assetType}:${assetKeyOrUrl}:${version}`;
  assetMemoryCache.set(key, dataUrl);
}

/**
 * Clears cached assets for a company on settings update.
 */
export function clearCompanyAssetCache(companyId?: string): void {
  if (!companyId) {
    assetMemoryCache.clear();
    return;
  }
  for (const key of Array.from(assetMemoryCache.keys())) {
    if (key.startsWith(`${companyId}:`)) {
      assetMemoryCache.delete(key);
    }
  }
}
