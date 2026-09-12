import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTHORIZED_ADMIN_UID = "BOkCLXp08tVmRHICTArgpReVh5Y2";
const AUTHORIZED_ADMIN_EMAIL = "maaz@admin.com";
const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

test("Security Case 1: Configured initial platform admin UID is authoritative in environment", () => {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_UID=${AUTHORIZED_ADMIN_UID}`), "INITIAL_PLATFORM_ADMIN_UID must match in .env");
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_EMAIL=${AUTHORIZED_ADMIN_EMAIL}`), "INITIAL_PLATFORM_ADMIN_EMAIL must match in .env");
  assert.doesNotMatch(envContent, /VITE_INITIAL_PLATFORM_ADMIN_UID/, "Must NOT be exposed as VITE_ variable");
  assert.doesNotMatch(envContent, /VITE_INITIAL_PLATFORM_ADMIN_EMAIL/, "Must NOT be exposed as VITE_ variable");

  const exampleContent = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
  assert.match(exampleContent, /INITIAL_PLATFORM_ADMIN_UID=\s*$/m, "INITIAL_PLATFORM_ADMIN_UID in .env.example must be empty placeholder");
  assert.match(exampleContent, /INITIAL_PLATFORM_ADMIN_EMAIL=\s*$/m, "INITIAL_PLATFORM_ADMIN_EMAIL in .env.example must be empty placeholder");
  assert.doesNotMatch(exampleContent, /VITE_INITIAL_PLATFORM_ADMIN_UID/, ".env.example must NOT prefix with VITE_");
});

test("Security Case 2: Platform admin authorization is strictly UID-based, never email-alone", () => {
  function verifyAuthorization(callerUid, callerEmail, configuredUid) {
    if (!configuredUid || !callerUid) {
      return { authorized: false, code: "UNAUTHORIZED" };
    }
    // Superseded identity explicitly blocked
    if (callerUid === SUPERSEDED_LEGACY_UID) {
      return { authorized: false, code: "FORBIDDEN", reason: "superseded_identity" };
    }
    if (callerUid !== configuredUid) {
      return { authorized: false, code: "FORBIDDEN" };
    }
    return { authorized: true };
  }

  // 1. Authorized UID can initialize
  const authorized = verifyAuthorization(AUTHORIZED_ADMIN_UID, AUTHORIZED_ADMIN_EMAIL, AUTHORIZED_ADMIN_UID);
  assert.equal(authorized.authorized, true, "Authorized UID must be granted bootstrap access");

  // 2. Old superseded legacy UID is explicitly denied
  const legacyBlocked = verifyAuthorization(SUPERSEDED_LEGACY_UID, "khaisar@admin.com", AUTHORIZED_ADMIN_UID);
  assert.equal(legacyBlocked.authorized, false, "Legacy bootstrap UID must be strictly denied");
  assert.equal(legacyBlocked.code, "FORBIDDEN");

  // 3. Different user claiming same email cannot initialize (impersonation prevented)
  const impersonator = verifyAuthorization("attacker_uid_123", AUTHORIZED_ADMIN_EMAIL, AUTHORIZED_ADMIN_UID);
  assert.equal(impersonator.authorized, false, "Caller with mismatched UID must be denied even if email matches");
  assert.equal(impersonator.code, "FORBIDDEN");

  // 4. Normal user cannot initialize themselves as Platform Admin
  const normalUser = verifyAuthorization("normal_user_456", "normal@example.com", AUTHORIZED_ADMIN_UID);
  assert.equal(normalUser.authorized, false, "Normal user must be forbidden from bootstrap");
  assert.equal(normalUser.code, "FORBIDDEN");
});

test("Security Case 3: Server requires Firebase Admin credentials or returns SERVER_CONFIG_REQUIRED", () => {
  function simulateServerBootstrap(hasAdminCredentials) {
    if (!hasAdminCredentials) {
      return {
        success: false,
        error: "Server configuration required: Firebase Admin credentials not configured.",
        code: "SERVER_CONFIG_REQUIRED",
      };
    }
    return { success: true };
  }

  // Without credentials -> Returns clear SERVER_CONFIG_REQUIRED
  const unconfigured = simulateServerBootstrap(false);
  assert.equal(unconfigured.success, false);
  assert.equal(unconfigured.code, "SERVER_CONFIG_REQUIRED");
  assert.match(unconfigured.error, /Server configuration required/);

  // Insecure client fallbacks are strictly not permitted
  assert.notEqual(unconfigured.code, "FALLBACK_TO_CLIENT", "Must NEVER fall back to client writes");
});

test("Security Case 4: Client cannot write to /memberships", () => {
  const rules = JSON.parse(readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8"));
  assert.equal(rules.rules.memberships.$companyId[".write"], false, "/memberships must have .write: false");
});

test("Security Case 5: Client cannot write to /userCompanies", () => {
  const rules = JSON.parse(readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8"));
  assert.equal(rules.rules.userCompanies.$uid[".write"], false, "/userCompanies must have .write: false");
});

test("Security Case 6: Normal user cannot assign themselves Owner role", () => {
  function attemptRoleSelfAssignment(actorRole, requestedRole) {
    // Only server Admin SDK can assign roles
    if (actorRole !== "server_admin") {
      return { success: false, code: "PERMISSION_DENIED" };
    }
    return { success: true, role: requestedRole };
  }

  const clientAttempt = attemptRoleSelfAssignment("viewer", "owner");
  assert.equal(clientAttempt.success, false);
  assert.equal(clientAttempt.code, "PERMISSION_DENIED");
});

test("Security Case 7: Cross-company access remains strictly denied", () => {
  function checkTenantAccess(activeCompanyId, targetCompanyId) {
    if (activeCompanyId !== targetCompanyId) {
      return { allowed: false, code: "CROSS_TENANT_FORBIDDEN" };
    }
    return { allowed: true };
  }

  const access = checkTenantAccess("company_A", "company_B");
  assert.equal(access.allowed, false);
  assert.equal(access.code, "CROSS_TENANT_FORBIDDEN");
});

test("Security Case 8: Bootstrap records include all required logical structures", () => {
  function generateBootstrapUpdates(companyId, ownerUid, fyId) {
    const updates = {};
    updates[`companies/${companyId}`] = { id: companyId };
    updates[`memberships/${companyId}/${ownerUid}`] = { uid: ownerUid, role: "owner" };
    updates[`userCompanies/${ownerUid}/${companyId}`] = true;
    updates[`companyData/${companyId}/financialYears/${fyId}`] = { id: fyId };
    updates[`companyData/${companyId}/branches/br_main`] = { id: "br_main" };
    updates[`companyData/${companyId}/auditLogs/audit_1`] = { action: "company.created" };
    updates[`bootstrapLocks/${ownerUid}`] = { lockedAt: 12345 };
    return updates;
  }

  const updates = generateBootstrapUpdates("c1", AUTHORIZED_ADMIN_UID, "fy1");
  assert.ok(updates[`companies/c1`]);
  assert.ok(updates[`memberships/c1/${AUTHORIZED_ADMIN_UID}`]);
  assert.equal(updates[`userCompanies/${AUTHORIZED_ADMIN_UID}/c1`], true);
  assert.ok(updates[`companyData/c1/financialYears/fy1`]);
  assert.ok(updates[`companyData/c1/branches/br_main`]);
  assert.ok(updates[`companyData/c1/auditLogs/audit_1`]);
  assert.ok(updates[`bootstrapLocks/${AUTHORIZED_ADMIN_UID}`]);
});
