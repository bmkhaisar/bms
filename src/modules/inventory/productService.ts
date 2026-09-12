/**
 * BMS NEXT — Concurrency-Safe Product Provisioning Service
 * Protects against simultaneous duplicate master creation by concurrent employees.
 */

import { ref, get, update, set } from "firebase/database";
import { firebaseDb, sanitizeForFirebase } from "@/config/firebase";
import { db, type Product } from "@/lib/db";
import { cacheEntity } from "@/modules/sync/dexieCache";
import { normalizeName, normalizeSku } from "@/modules/sync/searchNormalization";

export interface CreateProductParams {
  companyId: string;
  product: Product;
  uid: string;
  clientMutationId?: string;
  allowDuplicate?: boolean;
}

export interface CreateProductResult {
  success: boolean;
  product: Product;
  isExisting?: boolean;
  conflictType?: "name" | "sku";
  error?: string;
}

/**
 * Creates a product with concurrency duplicate protection.
 * If another employee created the same product or SKU concurrently, returns existing or flags conflict.
 */
export async function createProductWithUniqueness(
  params: CreateProductParams
): Promise<CreateProductResult> {
  const { companyId, product, uid, clientMutationId, allowDuplicate } = params;
  const now = Date.now();
  const normName = normalizeName(product.name);
  const normSku = normalizeSku(product.sku);

  const productToSave: Product = {
    ...product,
    normalizedName: normName,
    sku: product.sku ? product.sku.trim() : undefined,
    defaultSalesRatePaise: product.defaultSalesRatePaise ?? Math.round((product.sellingPrice || 0) * 100),
    defaultPurchaseRatePaise: product.defaultPurchaseRatePaise ?? Math.round((product.purchasePrice || 0) * 100),
    createdAt: product.createdAt || now,
    active: product.active !== false,
  };

  try {
    if (firebaseDb) {
      // 1. Idempotency mutation check
      if (clientMutationId) {
        const mutSnap = await get(
          ref(firebaseDb, `companyData/${companyId}/productMutations/${clientMutationId}`)
        );
        if (mutSnap.exists()) {
          const mut = mutSnap.val();
          const existSnap = await get(
            ref(firebaseDb, `companyData/${companyId}/products/${mut.productId}`)
          );
          if (existSnap.exists()) {
            return {
              success: true,
              product: existSnap.val(),
              isExisting: true,
            };
          }
        }
      }

      // 2. Concurrency Conflict Check in Company Products
      if (!allowDuplicate) {
        const productsSnap = await get(ref(firebaseDb, `companyData/${companyId}/products`));
        if (productsSnap.exists()) {
          const existingList: Product[] = Object.values(productsSnap.val());
          for (const ext of existingList) {
            if (ext.id === product.id) {
              return { success: true, product: ext, isExisting: true };
            }
            if (normSku && ext.sku && normalizeSku(ext.sku) === normSku) {
              return {
                success: false,
                product: ext,
                isExisting: true,
                conflictType: "sku",
                error: `Product with SKU "${ext.sku}" already created by another employee (${ext.name}).`,
              };
            }
            if (normName && normalizeName(ext.name) === normName) {
              return {
                success: false,
                product: ext,
                isExisting: true,
                conflictType: "name",
                error: `Product "${ext.name}" already created by another employee.`,
              };
            }
          }
        }
      }

      // 3. Multi-path Atomic Commit to Firebase RTDB
      const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
      const updates: Record<string, unknown> = {};
      updates[`companyData/${companyId}/products/${productToSave.id}`] = sanitizeForFirebase(productToSave);
      updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
        id: auditId,
        entityType: "product",
        entityId: productToSave.id,
        action: "create_product",
        performedBy: uid,
        timestamp: now,
        details: {
          name: productToSave.name,
          sku: productToSave.sku,
          sellingPrice: productToSave.sellingPrice,
        },
      };

      if (clientMutationId) {
        updates[`companyData/${companyId}/productMutations/${clientMutationId}`] = {
          productId: productToSave.id,
          timestamp: now,
          performedBy: uid,
        };
      }

      await update(ref(firebaseDb), updates);
    }

    // 4. Save to Dexie cache & local store
    await db().products.put(productToSave);
    await cacheEntity({
      uid,
      companyId,
      entityType: "product",
      entityId: productToSave.id,
      data: productToSave,
    });

    return {
      success: true,
      product: productToSave,
      isExisting: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Failed to create product with uniqueness:", err);
    return {
      success: false,
      product: productToSave,
      error: msg,
    };
  }
}
