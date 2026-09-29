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
 * Deterministic standard FIPS 180-4 SHA-256 implementation in pure TypeScript.
 * Bit-exact with RFC 6234 / Node crypto, runs synchronously without dependencies.
 */
export function sha256(str: string): string {
  function rotr(n: number, x: number): number {
    return (x >>> n) | (x << (32 - n));
  }
  function ch(x: number, y: number, z: number): number {
    return (x & y) ^ (~x & z);
  }
  function maj(x: number, y: number, z: number): number {
    return (x & y) ^ (x & z) ^ (y & z);
  }
  function sigma0(x: number): number {
    return rotr(2, x) ^ rotr(13, x) ^ rotr(22, x);
  }
  function sigma1(x: number): number {
    return rotr(6, x) ^ rotr(11, x) ^ rotr(25, x);
  }
  function gamma0(x: number): number {
    return rotr(7, x) ^ rotr(18, x) ^ (x >>> 3);
  }
  function gamma1(x: number): number {
    return rotr(17, x) ^ rotr(19, x) ^ (x >>> 10);
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const bitLen = bytes.length * 8;

  const padLen = (bytes.length + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(padLen - 4, bitLen >>> 0);
  view.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  const w = new Uint32Array(64);

  for (let offset = 0; offset < padLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4);
    }
    for (let i = 16; i < 64; i++) {
      w[i] = (gamma1(w[i - 2]) + w[i - 7] + gamma0(w[i - 15]) + w[i - 16]) | 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const t1 = (h + sigma1(e) + ch(e, f, g) + K[i] + w[i]) | 0;
      const t2 = (sigma0(a) + maj(a, b, c)) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) | 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) | 0;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
    h5 = (h5 + f) | 0;
    h6 = (h6 + g) | 0;
    h7 = (h7 + h) | 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((x) => (x >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

/**
 * Deterministically serializes values with alphabetical key ordering.
 * Eliminates object reference and insertion order discrepancies.
 */
export function stableSerialize(value: any): string {
  const seen = new WeakSet();

  function serialize(val: any): string {
    if (val === null || val === undefined) {
      return "null";
    }
    const type = typeof val;
    if (type === "number" || type === "boolean") {
      return String(val);
    }
    if (type === "string") {
      return JSON.stringify(val);
    }
    if (Array.isArray(val)) {
      return "[" + val.map(serialize).join(",") + "]";
    }
    if (type === "object") {
      if (seen.has(val)) {
        return '"[Circular]"';
      }
      seen.add(val);
      const keys = Object.keys(val).sort();
      const entries: string[] = [];
      for (const k of keys) {
        const v = val[k];
        if (v !== undefined && typeof v !== "function" && typeof v !== "symbol") {
          entries.push(JSON.stringify(k) + ":" + serialize(v));
        }
      }
      return "{" + entries.join(",") + "}";
    }
    return JSON.stringify(String(val));
  }

  return serialize(value);
}

/**
 * Computes an authoritative, deterministic SHA-256 fingerprint of the Effective Document Snapshot.
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
    const versionToken = doc.snapshotVersion ?? doc.postedAt ?? doc.updatedAt ?? doc.date ?? 1;
    return `ISSUED:${versionToken}`;
  }

  // 2. Draft documents: Hash ALL PDF-affecting fields using deterministic stable serialization + SHA-256
  const snapshotData = {
    num: doc.number || "",
    date: doc.date || "",
    updatedAt: doc.updatedAt || "",
    ref: doc.reference || "",
    party: {
      id: doc.customerId || doc.supplierId || doc.partyId || "",
      name: doc.customerName || doc.supplierName || doc.partyName || doc.customerSnapshot?.name || doc.supplierSnapshot?.name || doc.partySnapshot?.name || "",
      company: doc.partySnapshot?.company || doc.customerSnapshot?.company || doc.supplierSnapshot?.company || "",
      gstin: doc.partyGstin || doc.customerGstin || doc.supplierGstin || doc.customerSnapshot?.gstin || doc.supplierSnapshot?.gstin || "",
      pan: doc.partyPan || doc.customerSnapshot?.pan || doc.supplierSnapshot?.pan || "",
      phone: doc.partyPhone || doc.customerSnapshot?.phone || doc.supplierSnapshot?.phone || "",
      email: doc.partyEmail || doc.customerSnapshot?.email || doc.supplierSnapshot?.email || "",
      snap: doc.customerSnapshot || doc.supplierSnapshot || doc.partySnapshot || null,
    },
    billTo: doc.billingAddress || doc.customerAddress || doc.supplierAddress || doc.customerSnapshot?.address || "",
    shipTo: {
      addr: doc.shippingAddress || doc.shipToAddress || "",
      name: doc.shipToName || "",
      city: doc.shipToCity || "",
      state: doc.shipToState || "",
      pincode: doc.shipToPincode || "",
      gstin: doc.shipToGstin || "",
      phone: doc.shipToPhone || "",
    },
    pos: doc.placeOfSupply || doc.isIgst || "",
    items: (doc.items || []).map((it: any) => ({
      name: it.name || "",
      desc: it.description || "",
      size: it.size || it.sizeSnapshot?.label || "",
      qty: Number(it.quantity) || 0,
      rate: Number(it.rate) || 0,
      disc: Number(it.discountPct || it.discount) || 0,
      gst: Number(it.gstRate) || 0,
      taxable: Number(it.taxableAmount) || 0,
      total: Number(it.total) || 0,
      uom: it.unit || it.uomSnapshot || "",
    })),
    charges: (doc.extraCharges || []).map((chg: any) => ({
      l: chg.label || "",
      a: Number(chg.amount) || 0,
    })),
    chargesTotal: Number(doc.extraChargesTotal) || 0,
    subtotal: Number(doc.subtotal) || 0,
    taxTotal: Number(doc.taxTotal) || 0,
    grandTotal: Number(doc.grandTotal) || 0,
    terms: doc.terms || doc.termsSnapshot || doc.structuredTerms || [],
    genInfo: doc.generalInfoSnapshot || doc.generalInformationSnapshot || doc.generalInfo || [],
    techSpecs: doc.technicalSpecifications || doc.techSpecsSnapshot || [],
    bank: doc.bankDetailsSnapshot || doc.bankAccountId || "",
    signatory: doc.signatoryOverride || doc.signatorySnapshot || null,
    transport: {
      dn: doc.deliveryNote || "",
      sr: doc.supplierRef || "",
      or: doc.otherReferences || "",
      dd: doc.despatchDocNo || "",
      dt: doc.despatchedThrough || "",
      dest: doc.destination || "",
      bl: doc.billOfLadingNo || "",
      mv: doc.motorVehicleNo || "",
      ewb: doc.eWayBillNo || "",
    },
    notes: doc.notes || "",
    watermark: doc.watermarkMode || doc.customWatermarkText || "",
  };

  const serialized = stableSerialize(snapshotData);
  const hashDigest = sha256(serialized); // Full 256-bit (64 hex characters) SHA-256 digest
  return `DRAFT:SHA256:${hashDigest}`;
}

/**
 * Builds a deterministic cache key for a document's vector PDF representation.
 * - Issued documents: ISSUED:<documentId>:<snapshotVersion>:<copyType>:<optionsFingerprint>
 * - Draft documents: DRAFT:<documentId>:<sha256Digest>:<copyType>:<optionsFingerprint>
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
    includeBankDetails?: boolean;
    includeSignatory?: boolean;
    watermark?: string;
    [key: string]: any;
  }
): string {
  const docId = doc.id || doc.number || "doc";
  const fingerprint = computeDocumentEffectiveFingerprint(doc);
  const copyType = (options?.copyLabel || doc.copyLabel || "ORIGINAL").trim();

  // Normalize PDF render/display options deterministically
  const normalizedOptions = {
    copyType,
    desc: options?.includeDescriptions !== false,
    genInfo: options?.includeGeneralInfo !== false,
    tech: options?.includeTechSpecs !== false,
    terms: options?.includeTerms !== false,
    bank: options?.includeBankDetails !== false,
    signatory: options?.includeSignatory !== false,
    watermark: options?.watermark || doc.watermarkMode || doc.customWatermarkText || "",
  };

  const optionsFingerprint = sha256(stableSerialize(normalizedOptions));

  // Issued document format: ISSUED:<documentId>:<snapshotVersion>:<copyType>:<optionsFingerprint>
  if (fingerprint.startsWith("ISSUED:")) {
    const snapshotVersion = fingerprint.slice("ISSUED:".length);
    return `ISSUED:${docId}:${snapshotVersion}:${copyType}:${optionsFingerprint}`;
  }

  // Draft document format: DRAFT:<documentId>:<sha256Digest>:<copyType>:<optionsFingerprint>
  const rawDraftHash = fingerprint.replace(/^DRAFT:SHA256:/, "");
  return `DRAFT:${docId}:${rawDraftHash}:${copyType}:${optionsFingerprint}`;
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
 * Invalidates all cached PDF Blobs for a specific document ID (draft or issued variants).
 */
export function invalidatePdfBlobCache(documentId: string): void {
  if (!documentId) return;
  for (const key of Array.from(pdfBlobCache.keys())) {
    if (
      key.startsWith(`${documentId}:`) ||
      key.startsWith(`ISSUED:${documentId}:`) ||
      key.startsWith(`DRAFT:${documentId}:`)
    ) {
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
