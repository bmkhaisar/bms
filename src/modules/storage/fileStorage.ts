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
