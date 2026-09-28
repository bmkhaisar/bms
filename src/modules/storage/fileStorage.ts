/**
 * Binary File Storage Abstraction
 * Supports Cloudflare R2 / S3-compatible providers.
 * Enforces explicit StorageNotConfigured fallback when credentials are unavailable.
 */

export interface StorageResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: "STORAGE_NOT_CONFIGURED" | "UPLOAD_FAILED" | "DELETE_FAILED";
}

export interface PresignedUploadResult {
  uploadUrl: string;
  publicUrl: string;
  fileKey: string;
}

export interface FileStorageProvider {
  isConfigured(): boolean;
  createPresignedUpload(params: {
    key: string;
    contentType: string;
    companyId: string;
  }): Promise<StorageResult<PresignedUploadResult>>;
  deleteFile(key: string): Promise<StorageResult<void>>;
}

/**
 * Null/Unconfigured Provider used when R2 credentials are not supplied.
 * Strictly avoids generating fake URLs or simulating phantom uploads.
 */
export class UnconfiguredStorageProvider implements FileStorageProvider {
  isConfigured(): boolean {
    return false;
  }

  async createPresignedUpload(): Promise<StorageResult<PresignedUploadResult>> {
    return {
      success: false,
      error: "File storage is not configured yet. Set R2 credentials in environment to enable uploads.",
      code: "STORAGE_NOT_CONFIGURED",
    };
  }

  async deleteFile(): Promise<StorageResult<void>> {
    return {
      success: false,
      error: "File storage is not configured yet.",
      code: "STORAGE_NOT_CONFIGURED",
    };
  }
}

export const defaultStorageProvider: FileStorageProvider = new UnconfiguredStorageProvider();

/**
 * Multi-Tenant & Branch R2 Storage Authorization (Hardening Item 9)
 * Enforces:
 * 1. Strict tenant isolation: Organization A can never access Organization B assets.
 * 2. Branch isolation: Restricted Branch A users cannot access Branch B assets.
 * 3. Master assets (e.g. logos, product master) accessible organization-wide.
 * 4. Knowing an object key does not grant unauthorized access.
 */

export interface TenantAssetKeyParams {
  companyId: string;
  branchId?: string | null;
  category: "logos" | "product_images" | "attachments" | "signatures" | "stamps" | "pdf_docs";
  filename: string;
}

export function buildTenantAssetKey(params: TenantAssetKeyParams): string {
  const cleanComp = params.companyId.replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanCat = params.category;
  const cleanFile = params.filename.replace(/[^a-zA-Z0-9_.-]/g, "_");

  if (params.branchId && params.branchId !== "all") {
    const cleanBranch = params.branchId.replace(/[^a-zA-Z0-9_-]/g, "");
    return `tenants/${cleanComp}/branches/${cleanBranch}/${cleanCat}/${cleanFile}`;
  }
  return `tenants/${cleanComp}/master/${cleanCat}/${cleanFile}`;
}

export function parseTenantAssetKey(key: string): {
  companyId: string | null;
  branchId: string | null;
  category: string | null;
  filename: string | null;
  isMaster: boolean;
} {
  const parts = key.split("/");
  if (parts.length >= 5 && parts[0] === "tenants") {
    const companyId = parts[1];
    if (parts[2] === "branches") {
      return {
        companyId,
        branchId: parts[3],
        category: parts[4],
        filename: parts.slice(5).join("/"),
        isMaster: false,
      };
    } else if (parts[2] === "master") {
      return {
        companyId,
        branchId: null,
        category: parts[3],
        filename: parts.slice(4).join("/"),
        isMaster: true,
      };
    }
  }
  return { companyId: null, branchId: null, category: null, filename: null, isMaster: false };
}

export function verifyR2AssetAccess(params: {
  key: string;
  callerCompanyId: string;
  callerRole: string;
  callerAllBranches?: boolean;
  callerBranchIds?: string[];
}): { authorized: boolean; error?: string } {
  const { key, callerCompanyId, callerRole, callerAllBranches, callerBranchIds = [] } = params;
  const parsed = parseTenantAssetKey(key);

  if (!parsed.companyId) {
    return { authorized: false, error: "Invalid R2 asset key format." };
  }

  // Tenant Boundary: Organization A can NEVER access Organization B
  if (parsed.companyId !== callerCompanyId) {
    return {
      authorized: false,
      error: "Forbidden: Cross-organization asset access is strictly prohibited.",
    };
  }

  // Owner and allBranches users can access all assets within their organization
  const role = callerRole.toLowerCase();
  if (role === "owner" || callerAllBranches) {
    return { authorized: true };
  }

  // Organization-wide master assets (logos, catalog photos) accessible to all company members
  if (parsed.isMaster) {
    return { authorized: true };
  }

  // Branch-specific assets (branch signatures, stamps, attachments)
  if (parsed.branchId && !callerBranchIds.includes(parsed.branchId)) {
    return {
      authorized: false,
      error: `Forbidden: You do not have permission to access assets for branch '${parsed.branchId}'.`,
    };
  }

  return { authorized: true };
}
