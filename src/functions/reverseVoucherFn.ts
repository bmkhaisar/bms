import { createServerFn } from "@tanstack/react-start";
import type { ReverseVoucherInput, ReverseVoucherResult } from "@/modules/accounting/types";

/**
 * Server Function RPC for reversing double-entry vouchers.
 * Executes strictly on the server with Firebase Admin verification.
 */
export const reverseVoucherServerFn = createServerFn({ method: "POST" })
  .validator((data: ReverseVoucherInput) => data)
  .handler(async ({ data }): Promise<ReverseVoucherResult> => {
    const { executeReverseVoucher } = await import("@/server/accounting/reversalEngine");
    return await executeReverseVoucher(data);
  });
