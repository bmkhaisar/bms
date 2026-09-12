import { createServerFn } from "@tanstack/react-start";
import type { ManageLedgerInput, ManageLedgerResult } from "@/modules/accounting/types";

/**
 * Server Function RPC for creating and updating ledgers.
 * Enforces server-side validation and auditable double-entry opening balance offset.
 */
export const manageLedgerServerFn = createServerFn({ method: "POST" })
  .validator((data: ManageLedgerInput) => data)
  .handler(async ({ data }): Promise<ManageLedgerResult> => {
    const { executeManageLedger } = await import("@/server/accounting/manageLedger");
    return await executeManageLedger(data);
  });
