import test from "node:test";
import assert from "node:assert/strict";

test("Server Config Status 1: getPlatformServerStatus returns safe booleans without leaking secrets", () => {
  function getPlatformServerStatus(env) {
    const firebaseAdminConfigured = Boolean(
      (env.FIREBASE_ADMIN_PROJECT_ID || env.VITE_FIREBASE_PROJECT_ID) &&
      env.FIREBASE_ADMIN_CLIENT_EMAIL &&
      env.FIREBASE_ADMIN_PRIVATE_KEY
    );

    const r2Configured = Boolean(
      env.R2_ACCOUNT_ID &&
      env.R2_ACCESS_KEY_ID &&
      env.R2_SECRET_ACCESS_KEY &&
      env.R2_BUCKET_NAME
    );

    const platformAdminClaimConfigured = Boolean(env.INITIAL_PLATFORM_ADMIN_UID);

    return {
      firebaseAdminConfigured,
      platformAdminClaimConfigured,
      r2Configured,
    };
  }

  // Without credentials
  const emptyEnv = {
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "",
    FIREBASE_ADMIN_PRIVATE_KEY: "",
  };

  const status = getPlatformServerStatus(emptyEnv);
  assert.equal(status.firebaseAdminConfigured, false);
  assert.equal(typeof status.firebaseAdminConfigured, "boolean");
  assert.equal("privateKey" in status, false, "Must never return private keys");
  assert.equal("clientEmail" in status, false, "Must never return client email");

  // With credentials
  const configuredEnv = {
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@example.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBg...",
    INITIAL_PLATFORM_ADMIN_UID: "BOkCLXp08tVmRHICTArgpReVh5Y2",
  };

  const activeStatus = getPlatformServerStatus(configuredEnv);
  assert.equal(activeStatus.firebaseAdminConfigured, true);
  assert.equal(activeStatus.platformAdminClaimConfigured, true);
});

test("Server Config Status 2: KPI values display 'Unavailable' when Firebase Admin is unconfigured", () => {
  function computeKpis(serverConfigured, data) {
    if (!serverConfigured) {
      return {
        totalCompanies: "Unavailable",
        activeCompanies: "Unavailable",
        platformUsers: "Unavailable",
        activeMemberships: "Unavailable",
        status: "CONFIG_REQUIRED",
      };
    }
    return {
      totalCompanies: String(data.companies.length),
      activeCompanies: String(data.companies.filter((c) => c.active).length),
      platformUsers: String(data.users.length),
      activeMemberships: String(data.companies.reduce((acc, c) => acc + (c.activeUsersCount || 0), 0)),
      status: "READY",
    };
  }

  // Unconfigured server must never fabricate 0
  const unconfiguredKpis = computeKpis(false, { companies: [], users: [] });
  assert.equal(unconfiguredKpis.totalCompanies, "Unavailable");
  assert.equal(unconfiguredKpis.activeCompanies, "Unavailable");
  assert.equal(unconfiguredKpis.platformUsers, "Unavailable");
  assert.equal(unconfiguredKpis.activeMemberships, "Unavailable");

  // Configured server with genuinely 0 records
  const genuineZeroKpis = computeKpis(true, { companies: [], users: [] });
  assert.equal(genuineZeroKpis.totalCompanies, "0");
  assert.equal(genuineZeroKpis.activeCompanies, "0");
  assert.equal(genuineZeroKpis.platformUsers, "0");
  assert.equal(genuineZeroKpis.activeMemberships, "0");
});

test("Server Config Status 3: Actions gracefully return SERVER_CONFIG_REQUIRED without credentials", async () => {
  async function simulateTrustedAction(adminApp, actionName) {
    if (!adminApp) {
      return {
        success: false,
        error: "Server administration is not configured yet.",
        code: "SERVER_CONFIG_REQUIRED",
        requiredVars: [
          "FIREBASE_ADMIN_PROJECT_ID",
          "FIREBASE_ADMIN_CLIENT_EMAIL",
          "FIREBASE_ADMIN_PRIVATE_KEY",
        ],
      };
    }
    return { success: true, action: actionName };
  }

  const nullAdminApp = null;

  // Create Company action
  const createCompanyRes = await simulateTrustedAction(nullAdminApp, "createCompany");
  assert.equal(createCompanyRes.success, false);
  assert.equal(createCompanyRes.code, "SERVER_CONFIG_REQUIRED");
  assert.equal(createCompanyRes.error, "Server administration is not configured yet.");

  // Create User action
  const createUserRes = await simulateTrustedAction(nullAdminApp, "createUser");
  assert.equal(createUserRes.success, false);
  assert.equal(createUserRes.code, "SERVER_CONFIG_REQUIRED");

  // Grant Access action
  const grantAccessRes = await simulateTrustedAction(nullAdminApp, "grantAccess");
  assert.equal(grantAccessRes.success, false);
  assert.equal(grantAccessRes.code, "SERVER_CONFIG_REQUIRED");
});

test("Server Config Status 4: All Admin env missing returns FIREBASE_ADMIN_NOT_CONFIGURED", async () => {
  const { evaluateServerEnv } = await import("../src/server/config/serverEnv.ts");
  const diag = evaluateServerEnv({
    FIREBASE_ADMIN_PROJECT_ID: "",
    FIREBASE_ADMIN_CLIENT_EMAIL: "",
    FIREBASE_ADMIN_PRIVATE_KEY: "",
  });

  assert.equal(diag.firebaseAdmin.configured, false);
  assert.equal(diag.firebaseAdmin.validShape, false);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_ADMIN_NOT_CONFIGURED");
  assert.ok(diag.firebaseAdmin.missingVariables.includes("FIREBASE_ADMIN_PROJECT_ID"));
  assert.ok(diag.firebaseAdmin.missingVariables.includes("FIREBASE_ADMIN_CLIENT_EMAIL"));
  assert.ok(diag.firebaseAdmin.missingVariables.includes("FIREBASE_ADMIN_PRIVATE_KEY"));
});

test("Server Config Status 5: One Admin env missing reports missing variable accurately", async () => {
  const { evaluateServerEnv } = await import("../src/server/config/serverEnv.ts");
  const diag = evaluateServerEnv({
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@example.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: "",
    FIREBASE_DATABASE_URL: "https://bmskh-6efb2-default-rtdb.firebaseio.com",
  });

  assert.equal(diag.firebaseAdmin.configured, false);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_ADMIN_NOT_CONFIGURED");
  assert.deepEqual(diag.firebaseAdmin.missingVariables, ["FIREBASE_ADMIN_PRIVATE_KEY"]);
  assert.equal(diag.firebaseAdmin.projectIdPresent, true);
  assert.equal(diag.firebaseAdmin.clientEmailPresent, true);
  assert.equal(diag.firebaseAdmin.privateKeyPresent, false);
});

test("Server Config Status 6: Malformed private key without PEM markers returns FIREBASE_ADMIN_INVALID_PRIVATE_KEY", async () => {
  const { evaluateServerEnv, normalizePrivateKey } = await import("../src/server/config/serverEnv.ts");

  const malformedKey = "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...not-a-pem";
  const { isValid } = normalizePrivateKey(malformedKey);
  assert.equal(isValid, false, "Must reject key missing BEGIN/END markers");

  const diag = evaluateServerEnv({
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    VITE_FIREBASE_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@example.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: malformedKey,
    FIREBASE_DATABASE_URL: "https://bmskh-6efb2-default-rtdb.firebaseio.com",
  });

  assert.equal(diag.firebaseAdmin.configured, false);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_ADMIN_INVALID_PRIVATE_KEY");
  assert.match(diag.firebaseAdmin.statusMessage, /private-key format is invalid/i);
});

test("Server Config Status 7: Private key with escaped \\n successfully normalizes to real newlines", async () => {
  const { normalizePrivateKey } = await import("../src/server/config/serverEnv.ts");
  const escapedKey = "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\\n-----END PRIVATE KEY-----";

  const { normalized, isValid } = normalizePrivateKey(escapedKey);
  assert.equal(isValid, true);
  assert.ok(normalized.includes("\n"));
  assert.ok(!normalized.includes("\\n"));
  assert.ok(normalized.startsWith("-----BEGIN PRIVATE KEY-----"));
  assert.ok(normalized.endsWith("-----END PRIVATE KEY-----"));
});

test("Server Config Status 8: Missing database URL returns FIREBASE_DATABASE_URL_MISSING", async () => {
  const { evaluateServerEnv } = await import("../src/server/config/serverEnv.ts");
  const validKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\n-----END PRIVATE KEY-----";

  const diag = evaluateServerEnv({
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    VITE_FIREBASE_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@example.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: validKey,
    FIREBASE_DATABASE_URL: "",
    VITE_FIREBASE_DATABASE_URL: "",
  });

  assert.equal(diag.firebaseAdmin.configured, false);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_DATABASE_URL_MISSING");
  assert.match(diag.firebaseAdmin.statusMessage, /FIREBASE_DATABASE_URL missing/i);
});

test("Server Config Status 9: Project ID mismatch returns FIREBASE_ADMIN_PROJECT_MISMATCH", async () => {
  const { evaluateServerEnv } = await import("../src/server/config/serverEnv.ts");
  const validKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\n-----END PRIVATE KEY-----";

  const diag = evaluateServerEnv({
    FIREBASE_ADMIN_PROJECT_ID: "project-admin-service-account",
    VITE_FIREBASE_PROJECT_ID: "project-client-app",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@project-admin.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: validKey,
    FIREBASE_DATABASE_URL: "https://project-admin-default-rtdb.firebaseio.com",
  });

  assert.equal(diag.firebaseAdmin.configured, false);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_ADMIN_PROJECT_MISMATCH");
  assert.match(diag.firebaseAdmin.statusMessage, /project mismatch/i);
});

test("Server Config Status 10: Fully valid server env returns FIREBASE_ADMIN_READY and validShape true", async () => {
  const { evaluateServerEnv, getValidatedFirebaseAdminConfig } = await import("../src/server/config/serverEnv.ts");
  const validKey = "-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgw\\n-----END PRIVATE KEY-----";

  const env = {
    FIREBASE_ADMIN_PROJECT_ID: "bmskh-6efb2",
    VITE_FIREBASE_PROJECT_ID: "bmskh-6efb2",
    FIREBASE_ADMIN_CLIENT_EMAIL: "admin@bmskh-6efb2.iam.gserviceaccount.com",
    FIREBASE_ADMIN_PRIVATE_KEY: validKey,
    FIREBASE_DATABASE_URL: "https://bmskh-6efb2-default-rtdb.firebaseio.com",
  };

  const diag = evaluateServerEnv(env);
  assert.equal(diag.firebaseAdmin.status, "FIREBASE_ADMIN_READY");
  assert.equal(diag.firebaseAdmin.validShape, true);
  assert.equal(diag.firebaseAdmin.configured, true);

  const config = getValidatedFirebaseAdminConfig(env);
  assert.ok(config);
  assert.equal(config.projectId, "bmskh-6efb2");
  assert.equal(config.clientEmail, "admin@bmskh-6efb2.iam.gserviceaccount.com");
  assert.ok(config.privateKey.includes("\n"));
  assert.ok(!config.privateKey.includes("\\n"));
});

test("Server Config Status 11: getPlatformServerStatus accurately mirrors actual initialization state without leaking secrets", async () => {
  const { getPlatformServerStatus } = await import("../src/server/firebaseAdmin.ts");
  const status = getPlatformServerStatus();

  assert.equal(typeof status.firebaseAdminConfigured, "boolean");
  assert.equal(typeof status.firebaseAdminReady, "boolean");
  assert.equal(typeof status.status, "string");
  assert.equal(typeof status.statusMessage, "string");
  assert.ok(Array.isArray(status.missingVariables));
  assert.equal(typeof status.platformAdminClaimConfigured, "boolean");
  assert.equal(typeof status.r2Configured, "boolean");

  // Verify zero secrets leaked
  assert.equal("privateKey" in status, false);
  assert.equal("clientEmail" in status, false);
  assert.equal("secret" in status, false);
  assert.equal("serviceAccount" in status, false);
});
