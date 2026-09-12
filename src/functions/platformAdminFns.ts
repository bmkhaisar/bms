import { createServerFn } from "@tanstack/react-start";
import type { CreateCompanyInput } from "@/server/platform-admin/companyService";
import type { CreateUserInput } from "@/server/platform-admin/userService";
import type {
  GrantAccessInput,
  UpdateAccessInput,
  RevokeAccessInput,
  SuspendAccessInput,
  TransferOwnershipInput,
} from "@/server/platform-admin/accessService";

export const checkPlatformAdminServerFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data }) => {
    const { requirePlatformAdmin } = await import("@/server/platform-admin/auth");
    return await requirePlatformAdmin(data.idToken);
  });

export const checkPlatformAdminSetupStatusFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data }) => {
    const { checkPlatformAdminSetupStatus } = await import("@/server/platform-admin/auth");
    return await checkPlatformAdminSetupStatus(data.idToken);
  });

export const getPlatformServerStatusFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const { getPlatformServerStatus } = await import("@/server/firebaseAdmin");
    return getPlatformServerStatus();
  });

export const bootstrapPlatformAdminClaimFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data }) => {
    const { bootstrapPlatformAdminClaim } = await import("@/server/platform-admin/auth");
    return await bootstrapPlatformAdminClaim(data.idToken);
  });

export const createCompanyPlatformAdminFn = createServerFn({ method: "POST" })
  .validator((data: CreateCompanyInput) => data)
  .handler(async ({ data }) => {
    const { createCompanyAsPlatformAdmin } = await import("@/server/platform-admin/companyService");
    return await createCompanyAsPlatformAdmin(data);
  });

export const listCompaniesPlatformAdminFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data }) => {
    const { listCompaniesAsPlatformAdmin } = await import("@/server/platform-admin/companyService");
    return await listCompaniesAsPlatformAdmin(data.idToken);
  });

export const findUserPlatformAdminFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string; email: string }) => data)
  .handler(async ({ data }) => {
    const { findUserByEmail } = await import("@/server/platform-admin/userService");
    return await findUserByEmail(data.idToken, data.email);
  });

export const createPlatformUserFn = createServerFn({ method: "POST" })
  .validator((data: CreateUserInput) => data)
  .handler(async ({ data }) => {
    const { createPlatformUser } = await import("@/server/platform-admin/userService");
    return await createPlatformUser(data);
  });

export const listPlatformUsersFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string }) => data)
  .handler(async ({ data }) => {
    const { listPlatformUsers } = await import("@/server/platform-admin/userService");
    return await listPlatformUsers(data.idToken);
  });

export const grantCompanyAccessFn = createServerFn({ method: "POST" })
  .validator((data: GrantAccessInput) => data)
  .handler(async ({ data }) => {
    const { grantCompanyAccess } = await import("@/server/platform-admin/accessService");
    return await grantCompanyAccess(data);
  });

export const updateCompanyAccessFn = createServerFn({ method: "POST" })
  .validator((data: UpdateAccessInput) => data)
  .handler(async ({ data }) => {
    const { updateCompanyAccess } = await import("@/server/platform-admin/accessService");
    return await updateCompanyAccess(data);
  });

export const suspendCompanyAccessFn = createServerFn({ method: "POST" })
  .validator((data: SuspendAccessInput) => data)
  .handler(async ({ data }) => {
    const { suspendCompanyAccess } = await import("@/server/platform-admin/accessService");
    return await suspendCompanyAccess(data);
  });

export const revokeCompanyAccessFn = createServerFn({ method: "POST" })
  .validator((data: RevokeAccessInput) => data)
  .handler(async ({ data }) => {
    const { revokeCompanyAccess } = await import("@/server/platform-admin/accessService");
    return await revokeCompanyAccess(data);
  });

export const transferCompanyOwnershipFn = createServerFn({ method: "POST" })
  .validator((data: TransferOwnershipInput) => data)
  .handler(async ({ data }) => {
    const { transferCompanyOwnership } = await import("@/server/platform-admin/accessService");
    return await transferCompanyOwnership(data);
  });

export const listCompanyMembershipsFn = createServerFn({ method: "POST" })
  .validator((data: { idToken: string; companyId: string }) => data)
  .handler(async ({ data }) => {
    const { listCompanyMemberships } = await import("@/server/platform-admin/accessService");
    return await listCompanyMemberships(data.idToken, data.companyId);
  });
