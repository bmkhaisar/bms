import { createServerFn } from "@tanstack/react-start";
import { executeBootstrapCompany, type BootstrapCompanyInput, type BootstrapCompanyResult } from "./bootstrapCompany";

/**
 * First-class TanStack Start RPC server function.
 * Called from client React components without exposing server SDKs.
 */
export const bootstrapCompanyServerFn = createServerFn({ method: "POST" })
  .validator((data: BootstrapCompanyInput) => data)
  .handler(async ({ data }): Promise<BootstrapCompanyResult> => {
    return await executeBootstrapCompany(data);
  });
