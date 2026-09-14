import { ref, runTransaction } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { db, type ProductSizePreference, type SizeSnapshot } from "@/lib/db";

function normalizedLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

/** Stable key makes retries idempotent without using the display label as a Firebase path. */
export function productSizePreferenceId(productId: string, label: string): string {
  const input = `${productId}\u0000${normalizedLabel(label)}`;
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `psz_${productId}_${(hash >>> 0).toString(36)}`;
}

export async function rememberProductSize(params: {
  companyId: string;
  productId: string;
  size: SizeSnapshot;
}): Promise<ProductSizePreference> {
  const { companyId, productId } = params;
  const label = params.size.label.trim().replace(/\s+/g, " ");
  if (!companyId || !productId || !label) throw new Error("Company, product and size are required");

  const id = productSizePreferenceId(productId, label);
  const now = Date.now();
  const localExisting = await db().productSizes.get(id);
  let saved: ProductSizePreference = {
    id,
    productId,
    ...params.size,
    label,
    usageCount: (localExisting?.usageCount || 0) + 1,
    lastUsedAt: now,
    createdAt: localExisting?.createdAt || now,
    updatedAt: now,
    isFavorite: localExisting?.isFavorite,
    isDefault: localExisting?.isDefault,
  };

  if (firebaseDb) {
    const result = await runTransaction(
      ref(firebaseDb, `companyData/${companyId}/productSizes/${id}`),
      (current: ProductSizePreference | null) => ({
        ...current,
        id,
        productId,
        ...params.size,
        label,
        usageCount: (current?.usageCount || 0) + 1,
        lastUsedAt: now,
        createdAt: current?.createdAt || now,
        updatedAt: now,
      }),
      { applyLocally: false }
    );
    if (!result.committed) throw new Error("Size preference could not be saved");
    saved = result.snapshot.val() as ProductSizePreference;
  }

  await db().productSizes.put(saved);
  return saved;
}

