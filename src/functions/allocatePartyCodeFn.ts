import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { allocatePartyBusinessCode } from "@/server/accounting/numberingEngine";

interface Input {
  idToken: string;
  companyId: string;
  partyId: string;
  kind: "customer" | "supplier";
}

export const allocatePartyCodeServerFn = createServerFn({ method: "POST" })
  .validator((data: Input) => data)
  .handler(async ({ data }) => {
    const app = getFirebaseAdmin();
    if (!app) return { success: false as const, code: "SERVER_CONFIG_REQUIRED", error: "Server configuration required." };
    try {
      const decoded = await app.auth().verifyIdToken(data.idToken);
      const session = checkSessionAge(decoded);
      if (!session.valid) return { success: false as const, code: session.code, error: session.error };
      const db = app.database();
      const membership = await db.ref(`memberships/${data.companyId}/${decoded.uid}`).once("value");
      if (!membership.exists() || membership.val().status !== "active") {
        return { success: false as const, code: "FORBIDDEN", error: "Active company membership required." };
      }
      const partyCode = await allocatePartyBusinessCode(db, data);
      return { success: true as const, partyCode };
    } catch (error) {
      return { success: false as const, code: "ALLOCATION_FAILED", error: error instanceof Error ? error.message : String(error) };
    }
  });
