/**
 * Firebase Realtime Database implementation of IBranchRepository (PRD §§ 2, 3, 4, 14, 15, 33)
 * 
 * Enforces:
 * 1. Strict Organization Owner authorization: Only role === 'owner' can mutate branches.
 * 2. Immutable branchId.
 * 3. Exactly one active Main Branch per organization.
 * 4. Audit logging of all branch operations.
 * 5. Branch data isolation: Non-owners only see their assigned branches.
 */

import { getFirebaseAdmin } from "../firebaseAdmin";
import type {
  IBranchRepository,
  CreateBranchInput,
  UpdateBranchInput,
  BranchResult,
} from "./types";
import type { Branch } from "@/modules/company/types";
import { assertNoUndefinedValues } from "../firebasePayloadInvariant";

export class FirebaseBranchRepository implements IBranchRepository {
  /**
   * Authoritatively verify that the caller is an active OWNER of the company.
   */
  private async verifyOwner(db: any, companyId: string, callerUid: string): Promise<boolean> {
    if (!companyId || !callerUid) return false;
    const snap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!snap.exists()) return false;
    const mem = snap.val();
    const role = (mem.organizationRole || mem.role || "").toLowerCase();
    return mem.status === "active" && role === "owner";
  }

  async createBranch(input: CreateBranchInput): Promise<BranchResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, input.companyId, input.callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners are authorized to create branches.",
        code: "FORBIDDEN",
      };
    }

    if (!input.name?.trim() || !input.code?.trim()) {
      return {
        success: false,
        error: "Branch name and branch code are required.",
        code: "INVALID_INPUT",
      };
    }

    const cleanCode = input.code.trim().toUpperCase();
    const now = Date.now();

    // Check code uniqueness within company
    const existingSnap = await db.ref(`companyData/${input.companyId}/branches`).once("value");
    if (existingSnap.exists()) {
      const branches = existingSnap.val();
      for (const bId of Object.keys(branches)) {
        if (branches[bId]?.code?.toUpperCase() === cleanCode) {
          return {
            success: false,
            error: `A branch with code '${cleanCode}' already exists in this organization.`,
            code: "DUPLICATE_CODE",
          };
        }
      }
    }

    const branchId = `br_${now}_${Math.random().toString(36).substring(2, 7)}`;
    const isFirstBranch = !existingSnap.exists() || Object.keys(existingSnap.val() || {}).length === 0;
    const isMain = input.isMainBranch ?? isFirstBranch;

    const updates: Record<string, unknown> = {};

    // If this branch is marked as Main Branch, demote any previous main branches
    if (isMain && existingSnap.exists()) {
      const branches = existingSnap.val();
      for (const bId of Object.keys(branches)) {
        if (branches[bId]?.isMainBranch) {
          updates[`companyData/${input.companyId}/branches/${bId}/isMainBranch`] = false;
        }
      }
    }

    const branchData: Branch = {
      id: branchId,
      branchId,
      companyId: input.companyId,
      organizationId: input.companyId,
      name: input.name.trim(),
      code: cleanCode,
      branchCode: cleanCode,
      status: "active",
      active: true,
      isMainBranch: isMain,
      isBillingDefault: input.isBillingDefault ?? isMain,
      address: input.address?.trim() || "",
      city: input.city?.trim() || "",
      state: input.state?.trim() || "",
      pincode: input.pincode?.trim() || "",
      country: input.country || "India",
      phone: input.phone?.trim() || "",
      email: input.email?.trim() || "",
      gstin: input.gstin?.trim()?.toUpperCase() || "",
      invoicePrefix: input.invoicePrefix?.trim() || undefined,
      quotationPrefix: input.quotationPrefix?.trim() || undefined,
      purchasePrefix: input.purchasePrefix?.trim() || undefined,
      receiptPrefix: input.receiptPrefix?.trim() || undefined,
      paymentPrefix: input.paymentPrefix?.trim() || undefined,
      creditNotePrefix: input.creditNotePrefix?.trim() || undefined,
      bankName: input.bankName?.trim() || undefined,
      accountHolderName: input.accountHolderName?.trim() || undefined,
      bankAccountNo: input.bankAccountNo?.trim() || undefined,
      bankIfsc: input.bankIfsc?.trim() || undefined,
      bankBranch: input.bankBranch?.trim() || undefined,
      upiId: input.upiId?.trim() || undefined,
      authorizedSignatory: input.authorizedSignatory?.trim() || undefined,
      designation: input.designation?.trim() || undefined,
      signatureUrl: input.signatureUrl || undefined,
      stampUrl: input.stampUrl || undefined,
      createdAt: now,
      createdBy: input.callerUid,
      updatedAt: now,
    };

    updates[`companyData/${input.companyId}/branches/${branchId}`] = branchData;

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "branch",
      entityId: branchId,
      action: "BRANCH_CREATED",
      performedBy: input.callerUid,
      timestamp: now,
      details: {
        name: branchData.name,
        code: branchData.code,
        isMainBranch: isMain,
      },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      branch: branchData,
      branchId,
    };
  }

  async updateBranch(input: UpdateBranchInput): Promise<BranchResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, input.companyId, input.callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners are authorized to update branch configuration.",
        code: "FORBIDDEN",
      };
    }

    const branchRef = db.ref(`companyData/${input.companyId}/branches/${input.branchId}`);
    const snap = await branchRef.once("value");
    if (!snap.exists()) {
      return { success: false, error: "Branch not found", code: "NOT_FOUND" };
    }

    const current = snap.val();
    const now = Date.now();
    const updates: Record<string, unknown> = {};

    // Main Branch Invariant (Hardening Item 13):
    // 1. Cannot demote the sole active main branch without designating another branch as main
    if (input.isMainBranch === false && current.isMainBranch) {
      return {
        success: false,
        error: "Forbidden: An organization must always have exactly one Main Branch. Set another branch as Main Branch instead.",
        code: "CANNOT_DEMOTE_SOLE_MAIN",
      };
    }

    // 2. Atomic Main Branch switch: Use a database transaction across branches
    // Guarantees two concurrent requests setting different main branches never result in 2 main branches
    if (input.isMainBranch) {
      await db.ref(`companyData/${input.companyId}/branches`).transaction((branches: Record<string, any> | null) => {
        if (!branches) return branches;
        for (const bId of Object.keys(branches)) {
          if (branches[bId]) {
            branches[bId].isMainBranch = (bId === input.branchId);
          }
        }
        return branches;
      });
    }

    const updatedBranch: Branch = {
      ...current,
      name: input.name !== undefined ? input.name.trim() : current.name,
      code: input.code !== undefined ? input.code.trim().toUpperCase() : current.code,
      branchCode: input.code !== undefined ? input.code.trim().toUpperCase() : current.code,
      address: input.address !== undefined ? input.address.trim() : current.address,
      city: input.city !== undefined ? input.city.trim() : current.city,
      state: input.state !== undefined ? input.state.trim() : current.state,
      pincode: input.pincode !== undefined ? input.pincode.trim() : current.pincode,
      country: input.country !== undefined ? input.country : current.country,
      phone: input.phone !== undefined ? input.phone.trim() : current.phone,
      email: input.email !== undefined ? input.email.trim() : current.email,
      gstin: input.gstin !== undefined ? input.gstin.trim().toUpperCase() : current.gstin,
      isMainBranch: input.isMainBranch !== undefined ? input.isMainBranch : current.isMainBranch,
      isBillingDefault: input.isBillingDefault !== undefined ? input.isBillingDefault : current.isBillingDefault,
      invoicePrefix: input.invoicePrefix !== undefined ? input.invoicePrefix.trim() || undefined : current.invoicePrefix,
      quotationPrefix: input.quotationPrefix !== undefined ? input.quotationPrefix.trim() || undefined : current.quotationPrefix,
      purchasePrefix: input.purchasePrefix !== undefined ? input.purchasePrefix.trim() || undefined : current.purchasePrefix,
      receiptPrefix: input.receiptPrefix !== undefined ? input.receiptPrefix.trim() || undefined : current.receiptPrefix,
      paymentPrefix: input.paymentPrefix !== undefined ? input.paymentPrefix.trim() || undefined : current.paymentPrefix,
      creditNotePrefix: input.creditNotePrefix !== undefined ? input.creditNotePrefix.trim() || undefined : current.creditNotePrefix,
      branchDisplayName: input.branchDisplayName !== undefined ? input.branchDisplayName.trim() || undefined : current.branchDisplayName,
      useCompanyContactDefault: input.useCompanyContactDefault !== undefined ? input.useCompanyContactDefault : current.useCompanyContactDefault,
      useCompanyBankDefault: input.useCompanyBankDefault !== undefined ? input.useCompanyBankDefault : current.useCompanyBankDefault,
      useCompanySignatoryDefault: input.useCompanySignatoryDefault !== undefined ? input.useCompanySignatoryDefault : current.useCompanySignatoryDefault,
      useCompanyGeneralInfoDefault: input.useCompanyGeneralInfoDefault !== undefined ? input.useCompanyGeneralInfoDefault : current.useCompanyGeneralInfoDefault,
      useCompanyTechSpecsDefault: input.useCompanyTechSpecsDefault !== undefined ? input.useCompanyTechSpecsDefault : current.useCompanyTechSpecsDefault,
      useCompanyTermsDefault: input.useCompanyTermsDefault !== undefined ? input.useCompanyTermsDefault : current.useCompanyTermsDefault,
      bankName: input.bankName !== undefined ? input.bankName.trim() || undefined : current.bankName,
      accountHolderName: input.accountHolderName !== undefined ? input.accountHolderName.trim() || undefined : current.accountHolderName,
      bankAccountNo: input.bankAccountNo !== undefined ? input.bankAccountNo.trim() || undefined : current.bankAccountNo,
      bankIfsc: input.bankIfsc !== undefined ? input.bankIfsc.trim() || undefined : current.bankIfsc,
      bankBranch: input.bankBranch !== undefined ? input.bankBranch.trim() || undefined : current.bankBranch,
      bankAccountType: input.bankAccountType !== undefined ? input.bankAccountType.trim() || undefined : current.bankAccountType,
      bankSwiftCode: input.bankSwiftCode !== undefined ? input.bankSwiftCode.trim() || undefined : current.bankSwiftCode,
      upiId: input.upiId !== undefined ? input.upiId.trim() || undefined : current.upiId,
      authorizedSignatory: input.authorizedSignatory !== undefined ? input.authorizedSignatory.trim() || undefined : current.authorizedSignatory,
      designation: input.designation !== undefined ? input.designation.trim() || undefined : current.designation,
      signatureUrl: input.signatureUrl !== undefined ? input.signatureUrl || undefined : current.signatureUrl,
      stampUrl: input.stampUrl !== undefined ? input.stampUrl || undefined : current.stampUrl,
      signatureMode: input.signatureMode !== undefined ? input.signatureMode : current.signatureMode,
      typedSignatureStyle: input.typedSignatureStyle !== undefined ? input.typedSignatureStyle : current.typedSignatureStyle,
      stampMode: input.stampMode !== undefined ? input.stampMode : current.stampMode,
      quotationGeneralInfoMarkdown: input.quotationGeneralInfoMarkdown !== undefined ? input.quotationGeneralInfoMarkdown : current.quotationGeneralInfoMarkdown,
      quotationTechnicalSpecsMarkdown: input.quotationTechnicalSpecsMarkdown !== undefined ? input.quotationTechnicalSpecsMarkdown : current.quotationTechnicalSpecsMarkdown,
      quotationTermsMarkdown: input.quotationTermsMarkdown !== undefined ? input.quotationTermsMarkdown : current.quotationTermsMarkdown,
      invoiceTermsMarkdown: input.invoiceTermsMarkdown !== undefined ? input.invoiceTermsMarkdown : current.invoiceTermsMarkdown,
      updatedAt: now,
    };

    updates[`companyData/${input.companyId}/branches/${input.branchId}`] = updatedBranch;

    // Audit log
    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${input.companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "branch",
      entityId: input.branchId,
      action: "BRANCH_UPDATED",
      performedBy: input.callerUid,
      timestamp: now,
      details: { name: updatedBranch.name, isMainBranch: updatedBranch.isMainBranch },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      branch: updatedBranch,
      branchId: input.branchId,
    };
  }

  async setMainBranch(companyId: string, branchId: string, callerUid: string): Promise<BranchResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, companyId, callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners can set the Main Branch.",
        code: "FORBIDDEN",
      };
    }

    const branchesSnap = await db.ref(`companyData/${companyId}/branches`).once("value");
    if (!branchesSnap.exists()) {
      return { success: false, error: "No branches found", code: "NOT_FOUND" };
    }

    const branches = branchesSnap.val();
    if (!branches[branchId]) {
      return { success: false, error: `Branch ${branchId} does not exist`, code: "NOT_FOUND" };
    }

    if (branches[branchId].active === false || branches[branchId].status === "inactive") {
      return { success: false, error: "Cannot set an inactive branch as Main Branch", code: "INVALID_STATE" };
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {};

    for (const bId of Object.keys(branches)) {
      if (bId === branchId) {
        updates[`companyData/${companyId}/branches/${bId}/isMainBranch`] = true;
        updates[`companyData/${companyId}/branches/${bId}/isBillingDefault`] = true;
        updates[`companyData/${companyId}/branches/${bId}/updatedAt`] = now;
      } else if (branches[bId]?.isMainBranch) {
        updates[`companyData/${companyId}/branches/${bId}/isMainBranch`] = false;
        updates[`companyData/${companyId}/branches/${bId}/updatedAt`] = now;
      }
    }

    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "branch",
      entityId: branchId,
      action: "MAIN_BRANCH_CHANGED",
      performedBy: callerUid,
      timestamp: now,
      details: { newMainBranchId: branchId, branchName: branches[branchId].name },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      branchId,
    };
  }

  async deactivateBranch(companyId: string, branchId: string, callerUid: string): Promise<BranchResult> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return { success: false, error: "Firebase Admin is not configured on the server", code: "SERVER_CONFIG_REQUIRED" };
    }

    const db = adminApp.database();
    const isOwner = await this.verifyOwner(db, companyId, callerUid);
    if (!isOwner) {
      return {
        success: false,
        error: "Forbidden: Only Organization Owners can deactivate branches.",
        code: "FORBIDDEN",
      };
    }

    const branchRef = db.ref(`companyData/${companyId}/branches/${branchId}`);
    const snap = await branchRef.once("value");
    if (!snap.exists()) {
      return { success: false, error: "Branch not found", code: "NOT_FOUND" };
    }

    const branch = snap.val();
    if (branch.isMainBranch) {
      return {
        success: false,
        error: "Cannot deactivate the Main Branch. Designate another branch as Main Branch first.",
        code: "CANNOT_DEACTIVATE_MAIN",
      };
    }

    const now = Date.now();
    const updates: Record<string, unknown> = {
      [`companyData/${companyId}/branches/${branchId}/active`]: false,
      [`companyData/${companyId}/branches/${branchId}/status`]: "inactive",
      [`companyData/${companyId}/branches/${branchId}/updatedAt`]: now,
    };

    const auditId = `audit_${now}_${Math.random().toString(36).substring(2, 6)}`;
    updates[`companyData/${companyId}/auditLogs/${auditId}`] = {
      id: auditId,
      entityType: "branch",
      entityId: branchId,
      action: "BRANCH_DEACTIVATED",
      performedBy: callerUid,
      timestamp: now,
      details: { name: branch.name },
    };

    assertNoUndefinedValues(updates);
    await db.ref().update(updates);

    return {
      success: true,
      branchId,
    };
  }

  async getBranch(companyId: string, branchId: string): Promise<Branch | null> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return null;
    const snap = await adminApp.database().ref(`companyData/${companyId}/branches/${branchId}`).once("value");
    if (!snap.exists()) return null;
    const val = snap.val();
    return { ...val, id: val.id || branchId };
  }

  async listBranches(companyId: string, callerUid?: string): Promise<Branch[]> {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) return [];
    const db = adminApp.database();

    const snap = await db.ref(`companyData/${companyId}/branches`).once("value");
    if (!snap.exists()) return [];

    const raw = snap.val();
    const allBranches: Branch[] = Object.entries(raw).map(([id, val]: [string, any]) => ({
      ...val,
      id: val?.id || id,
      branchId: val?.id || id,
    }));

    if (!callerUid) return allBranches;

    // Check membership authorization
    const memSnap = await db.ref(`memberships/${companyId}/${callerUid}`).once("value");
    if (!memSnap.exists()) return [];
    const mem = memSnap.val();
    const role = (mem.organizationRole || mem.role || "").toLowerCase();

    // Owner gets all branches
    if (role === "owner" || mem.allBranches) {
      return allBranches;
    }

    // Filter to user's assigned branches
    const allowedBranchIds = new Set<string>();
    if (Array.isArray(mem.branchIds)) {
      mem.branchIds.forEach((id: string) => allowedBranchIds.add(id));
    }
    if (Array.isArray(mem.branchAccess)) {
      mem.branchAccess.forEach((ba: any) => ba.branchId && allowedBranchIds.add(ba.branchId));
    }

    return allBranches.filter((b) => allowedBranchIds.has(b.id));
  }
}
