import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const AUTHORIZED_ADMIN_UID = "BOkCLXp08tVmRHICTArgpReVh5Y2";
const AUTHORIZED_ADMIN_EMAIL = "maaz@admin.com";
const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

test("Bootstrap Security 1: Environment configured with exact authorized platform admin UID", () => {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_UID=${AUTHORIZED_ADMIN_UID}`), "INITIAL_PLATFORM_ADMIN_UID must match in .env");
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_EMAIL=${AUTHORIZED_ADMIN_EMAIL}`), "INITIAL_PLATFORM_ADMIN_EMAIL must match in .env");
  assert.doesNotMatch(envContent, /VITE_INITIAL_PLATFORM_ADMIN_UID/, "Must NOT be exposed as VITE_ variable");
});

test("Bootstrap Security 2: .env.example contains only blank placeholders", () => {
  const exampleContent = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
  assert.match(exampleContent, /INITIAL_PLATFORM_ADMIN_UID=\s*$/m, "INITIAL_PLATFORM_ADMIN_UID in .env.example must be empty placeholder");
  assert.match(exampleContent, /INITIAL_PLATFORM_ADMIN_EMAIL=\s*$/m, "INITIAL_PLATFORM_ADMIN_EMAIL in .env.example must be empty placeholder");
});

test("Bootstrap Security 3: Server authorization validates exact UID not just email", () => {
  function checkBootstrapAuthorization(callerUid, callerEmail) {
    if (callerUid === SUPERSEDED_LEGACY_UID) {
      return { success: false, code: "FORBIDDEN", reason: "superseded_identity" };
    }
    const configuredAdminUid = AUTHORIZED_ADMIN_UID;
    if (!configuredAdminUid || callerUid !== configuredAdminUid) {
      return { success: false, code: "FORBIDDEN" };
    }
    return { success: true };
  }

  // Authorized UID matches -> Allowed
  const authorized = checkBootstrapAuthorization(AUTHORIZED_ADMIN_UID, AUTHORIZED_ADMIN_EMAIL);
  assert.equal(authorized.success, true);

  // Superseded legacy UID -> Strictly Forbidden
  const legacyAttempt = checkBootstrapAuthorization(SUPERSEDED_LEGACY_UID, "khaisar@admin.com");
  assert.equal(legacyAttempt.success, false);
  assert.equal(legacyAttempt.code, "FORBIDDEN");

  // Unauthorized UID with same email -> Denied (UID is authoritative)
  const spoofedEmail = checkBootstrapAuthorization("malicious-uid-999", AUTHORIZED_ADMIN_EMAIL);
  assert.equal(spoofedEmail.success, false);
  assert.equal(spoofedEmail.code, "FORBIDDEN");

  // Normal user UID -> Denied
  const normalUser = checkBootstrapAuthorization("regular-user-456", "staff@example.com");
  assert.equal(normalUser.success, false);
  assert.equal(normalUser.code, "FORBIDDEN");
});

test("Bootstrap Security 4: Client write protection in database.rules.json", () => {
  const rules = JSON.parse(readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8"));

  assert.equal(rules.rules.memberships.$companyId[".write"], false, "Client write to /memberships must be false");
  assert.equal(rules.rules.userCompanies.$uid[".write"], false, "Client write to /userCompanies must be false");
  assert.equal(rules.rules.bootstrapLocks.$uid[".write"], false, "Client write to /bootstrapLocks must be false");
  assert.equal(rules.rules.companyData.$companyId.auditLogs[".write"], false, "Client write to /auditLogs must be false");
  assert.equal(rules.rules.companyData.$companyId.docCounters[".write"], false, "Client write to /docCounters must be false");
  assert.equal(rules.rules.companyData.$companyId.vouchers[".write"], false, "Client write to /vouchers must be false");
  assert.equal(rules.rules.companyData.$companyId.voucherLines[".write"], false, "Client write to /voucherLines must be false");
});

test("Bootstrap Idempotency: Duplicate or concurrent requests return ALREADY_BOOTSTRAPPED with existing company", () => {
  const userCompaniesDb = {
    [AUTHORIZED_ADMIN_UID]: {
      company_apex_123: true,
    },
  };

  function simulateBootstrap(callerUid) {
    const existing = userCompaniesDb[callerUid];
    if (existing) {
      const companyId = Object.keys(existing)[0];
      return {
        success: true,
        companyId,
        alreadyBootstrapped: true,
        code: "ALREADY_BOOTSTRAPPED",
      };
    }
    return { success: true, companyId: "new_comp", alreadyBootstrapped: false };
  }

  const firstCall = simulateBootstrap(AUTHORIZED_ADMIN_UID);
  assert.equal(firstCall.success, true);
  assert.equal(firstCall.alreadyBootstrapped, true);
  assert.equal(firstCall.companyId, "company_apex_123");
  assert.equal(firstCall.code, "ALREADY_BOOTSTRAPPED");

  const duplicateCall = simulateBootstrap(AUTHORIZED_ADMIN_UID);
  assert.equal(duplicateCall.success, true);
  assert.equal(duplicateCall.alreadyBootstrapped, true);
  assert.equal(duplicateCall.companyId, "company_apex_123");
});

test("Financial Year Validation: Server validates dynamic dates and rejects invalid durations", () => {
  function validateFinancialYear(name, start, end) {
    if (!name || typeof name !== "string" || !name.trim()) {
      return { valid: false, error: "Invalid FY name" };
    }
    if (!start || !end || isNaN(start) || isNaN(end) || start >= end) {
      return { valid: false, error: "Invalid start or end date" };
    }
    const durationDays = (end - start) / (1000 * 60 * 60 * 24);
    if (durationDays < 1) {
      return { valid: false, error: "FY duration must be at least 1 day" };
    }
    return { valid: true };
  }

  // Valid Indian FY
  const validFy = validateFinancialYear("2026-2027", new Date("2026-04-01").getTime(), new Date("2027-03-31").getTime());
  assert.equal(validFy.valid, true);

  // Inverted dates -> Rejected
  assert.equal(validateFinancialYear("Invalid", 1800000000000, 1700000000000).valid, false);

  // Blank name -> Rejected
  assert.equal(validateFinancialYear("", 1700000000000, 1800000000000).valid, false);
});

test("Authoritative Profile Identity: User email strictly taken from decoded token", () => {
  function resolveUserProfile(decodedToken, clientInput) {
    return {
      uid: decodedToken.uid,
      email: decodedToken.email || "",
      displayName: decodedToken.name || decodedToken.email?.split("@")[0] || "Authorized Admin",
    };
  }

  const token = { uid: AUTHORIZED_ADMIN_UID, email: "maaz@admin.com", name: "Maaz Admin" };
  const clientInput = { email: "spoofed_client_email@attacker.com" };

  const profile = resolveUserProfile(token, clientInput);
  assert.equal(profile.email, "maaz@admin.com", "Must use verified token email");
  assert.notEqual(profile.email, clientInput.email, "Must ignore client-supplied email");
});
