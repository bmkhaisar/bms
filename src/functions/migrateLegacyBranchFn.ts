import { createServerFn } from "@tanstack/react-start";
import { getFirebaseAdmin } from "@/server/firebaseAdmin";
import { checkSessionAge } from "@/server/authMiddleware";
import { runLegacyBranchBackfill, type MigrationSummary } from "@/server/migrations/legacyBranchBackfill";

export interface MigrateLegacyBranchInput {
  idToken: string;
  companyId: string;
  force?: boolean;
  dryRun?: boolean;
}

export interface MigrateLegacyBranchResult {
  success: boolean;
  summary?: MigrationSummary;
  error?: string;
  code?: string;
}

export const migrateLegacyBranchServerFn = createServerFn({ method: "POST" })
  .validator((data: MigrateLegacyBranchInput) => data)
  .handler(async ({ data }): Promise<MigrateLegacyBranchResult> => {
    const adminApp = getFirebaseAdmin();
    if (!adminApp) {
      return {
        success: false,
        error: "Server configuration required. Firebase Admin credentials missing.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }

    try {
      const decoded = await adminApp.auth().verifyIdToken(data.idToken);
      const session = checkSessionAge(decoded);
      if (!session.valid) {
        return { success: false, error: session.error, code: session.code };
      }

      const db = adminApp.database();
      // Verify caller is active owner or admin of this company
      const memSnap = await db.ref(`memberships/${data.companyId}/${decoded.uid}`).once("value");
      if (!memSnap.exists()) {
        return { success: false, error: "Not a member of this company.", code: "FORBIDDEN" };
      }

      const mem = memSnap.val();
      const role = (mem.organizationRole || mem.role || "").toLowerCase();
      if (mem.status !== "active" || (role !== "owner" && role !== "admin")) {
        return {
          success: false,
          error: "Forbidden: Only Organization Owners or Administrators may run legacy migrations.",
          code: "FORBIDDEN",
        };
      }

      const summary = await runLegacyBranchBackfill(
        db,
        data.companyId,
        decoded.uid,
        data.force,
        Boolean(data.dryRun)
      );
      return {
        success: true,
        summary,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  });
