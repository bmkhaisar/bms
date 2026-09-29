/**
 * BMS NEXT — Production PDF & Asset Cache Service
 * 
 * Implements Section 18 & 20 of BMS NEXT Performance Specification:
 * - Session-level PDF Blob caching for instant preview and download (< 10ms)
 * - Safe cache invalidation on document modification
 * - Pre-processed tenant brand asset caching (logos, stamps, signatures)
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
 * Builds a deterministic cache key for a document's vector PDF representation.
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
  const version = doc.updatedAt || doc.date || 0;
  const copyType = options?.copyLabel || doc.copyLabel || "ORIGINAL";
  const desc = options?.includeDescriptions !== false ? "1" : "0";
  const genInfo = options?.includeGeneralInfo !== false ? "1" : "0";
  const tech = options?.includeTechSpecs !== false ? "1" : "0";
  const terms = options?.includeTerms !== false ? "1" : "0";
  const itemsCount = doc.items?.length || 0;
  const total = doc.grandTotal || 0;

  return `${docId}:${version}:${total}:${itemsCount}:${copyType}:${desc}:${genInfo}:${tech}:${terms}`;
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
 */
export function getCachedAsset(companyId: string, assetType: string, assetKeyOrUrl: string): string | null {
  if (!companyId || !assetKeyOrUrl) return null;
  const key = `${companyId}:${assetType}:${assetKeyOrUrl}`;
  return assetMemoryCache.get(key) || null;
}

/**
 * Caches an asset data URL or object URL.
 */
export function setCachedAsset(companyId: string, assetType: string, assetKeyOrUrl: string, dataUrl: string): void {
  if (!companyId || !assetKeyOrUrl || !dataUrl) return;
  const key = `${companyId}:${assetType}:${assetKeyOrUrl}`;
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
