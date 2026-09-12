import { createServerFn } from "@tanstack/react-start";
import type { PostVoucherInput, PostVoucherResult } from "@/modules/accounting/types";

/**
 * Server Function RPC for posting double-entry vouchers.
 * Executes strictly on the server with Firebase Admin verification.
 */
export const postVoucherServerFn = createServerFn({ method: "POST" })
  .validator((data: PostVoucherInput) => data)
  .handler(async ({ data }): Promise<PostVoucherResult> => {
    const { executePostVoucher } = await import("@/server/accounting/postingEngine");
    return await executePostVoucher(data);
  });
