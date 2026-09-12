import { createServerFn } from "@tanstack/react-start";
import type { BootstrapCompanyInput, BootstrapCompanyResult } from "@/server/bootstrapCompany";

/**
 * First-class TanStack Start RPC bridge.
 * The handler executes strictly on the server and dynamically loads server modules.
 */
export const bootstrapCompanyServerFn = createServerFn({ method: "POST" })
  .validator((data: BootstrapCompanyInput) => data)
  .handler(async ({ data }): Promise<BootstrapCompanyResult> => {
    const { executeBootstrapCompany } = await import("@/server/bootstrapCompany");
    return await executeBootstrapCompany(data);
  });
