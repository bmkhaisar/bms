import { createServerFn } from "@tanstack/react-start";

export interface CheckInitialOwnerInput {
  uid: string;
}

export interface CheckInitialOwnerResult {
  isInitialOwner: boolean;
  configured: boolean;
}

/**
 * Server-side check for initial owner authorization.
 * Strictly checks caller UID against process.env.INITIAL_OWNER_UID on the server.
 * Never exposes the INITIAL_OWNER_UID in the client bundle.
 */
export const checkInitialOwnerServerFn = createServerFn({ method: "POST" })
  .validator((data: CheckInitialOwnerInput) => data)
  .handler(async ({ data }): Promise<CheckInitialOwnerResult> => {
    const configuredUid = process.env.INITIAL_PLATFORM_ADMIN_UID || process.env.INITIAL_OWNER_UID;
    const isInitialOwner = Boolean(
      configuredUid &&
      data?.uid &&
      data.uid === configuredUid
    );
    return {
      isInitialOwner,
      configured: Boolean(configuredUid),
    };
  });
