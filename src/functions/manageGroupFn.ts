import { createServerFn } from "@tanstack/react-start";
import type { ManageGroupInput, ManageGroupResult } from "@/server/accounting/manageGroup";

/**
 * Server Function RPC for creating and managing custom account groups.
 * Enforces parent nature inheritance to prevent chart corruption.
 */
export const manageGroupServerFn = createServerFn({ method: "POST" })
  .validator((data: ManageGroupInput) => data)
  .handler(async ({ data }): Promise<ManageGroupResult> => {
    const { executeManageGroup } = await import("@/server/accounting/manageGroup");
    return await executeManageGroup(data);
  });
