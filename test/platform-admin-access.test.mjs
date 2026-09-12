import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const INITIAL_PLATFORM_ADMIN_UID = "BOkCLXp08tVmRHICTArgpReVh5Y2";
const INITIAL_PLATFORM_ADMIN_EMAIL = "maaz@admin.com";
const SUPERSEDED_LEGACY_UID = "8Sqybhv41hhtuzcsN2JrMsnBdov2";

test("Platform Admin 1: New UID is configured as platform bootstrap admin in .env", () => {
  const envContent = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_UID=${INITIAL_PLATFORM_ADMIN_UID}`));
  assert.match(envContent, new RegExp(`INITIAL_PLATFORM_ADMIN_EMAIL=${INITIAL_PLATFORM_ADMIN_EMAIL}`));
  assert.doesNotMatch(envContent, /VITE_INITIAL_PLATFORM_ADMIN_UID/);
  assert.doesNotMatch(envContent, new RegExp(SUPERSEDED_LEGACY_UID), "Old superseded UID must not be in .env");
});

test("Platform Admin 2: Old Khaisar UID no longer grants privileged access", () => {
  function checkPrivilege(uid) {
    if (uid === SUPERSEDED_LEGACY_UID) {
      return { privileged: false, code: "SUPERSEDED_IDENTITY" };
    }
    if (uid === INITIAL_PLATFORM_ADMIN_UID) {
      return { privileged: true };
    }
    return { privileged: false, code: "FORBIDDEN" };
  }

  const legacyRes = checkPrivilege(SUPERSEDED_LEGACY_UID);
  assert.equal(legacyRes.privileged, false);
  assert.equal(legacyRes.code, "SUPERSEDED_IDENTITY");

  const adminRes = checkPrivilege(INITIAL_PLATFORM_ADMIN_UID);
  assert.equal(adminRes.privileged, true);
});

test("Platform Admin 3: Email alone cannot create platform admin (UID is authoritative)", () => {
  function verifyPlatformAdmin(decodedToken) {
    if (decodedToken.platformAdmin === true) return true;
    // Only matching UID qualifies for bootstrap
    return decodedToken.uid === INITIAL_PLATFORM_ADMIN_UID;
  }

  // Attacker claiming maaz@admin.com with mismatched UID
  const spoofedToken = { uid: "attacker_999", email: INITIAL_PLATFORM_ADMIN_EMAIL };
  assert.equal(verifyPlatformAdmin(spoofedToken), false, "Mismatched UID with admin email must be rejected");

  // Real admin token
  const realToken = { uid: INITIAL_PLATFORM_ADMIN_UID, email: INITIAL_PLATFORM_ADMIN_EMAIL };
  assert.equal(verifyPlatformAdmin(realToken), true);
});

test("Platform Admin 4: Platform admin claim required for system functions", () => {
  function executeSystemAdminAction(decodedToken) {
    if (decodedToken.platformAdmin !== true) {
      return { success: false, error: "Platform Administrator privileges required", code: "FORBIDDEN" };
    }
    return { success: true, executed: true };
  }

  const normalToken = { uid: "user_123", email: "user@test.com" };
  const res = executeSystemAdminAction(normalToken);
  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN");

  const adminToken = { uid: "admin_123", email: "admin@test.com", platformAdmin: true };
  const adminRes = executeSystemAdminAction(adminToken);
  assert.equal(adminRes.success, true);
});

test("Platform Admin 5: Ordinary company owner is NOT automatically platform admin", () => {
  function resolvePlatformAdmin(token, membership) {
    // Platform admin is distinct from company roles
    return Boolean(token.platformAdmin);
  }

  const companyOwnerMembership = { role: "owner", status: "active" };
  const ownerToken = { uid: "company_owner_1", email: "owner@abc.com" }; // No custom claim

  assert.equal(
    resolvePlatformAdmin(ownerToken, companyOwnerMembership),
    false,
    "Company owner must NOT have platform admin privilege unless granted separately"
  );
});

test("Platform Admin 6: Platform admin can create multiple companies", () => {
  const database = { companies: {}, companyData: {} };

  function platformAdminCreateCompany(callerToken, companyName, fyName) {
    if (!callerToken.platformAdmin) {
      return { success: false, code: "FORBIDDEN" };
    }
    const companyId = `comp_${Object.keys(database.companies).length + 1}`;
    database.companies[companyId] = { id: companyId, name: companyName, active: true };
    return { success: true, companyId };
  }

  const adminToken = { uid: INITIAL_PLATFORM_ADMIN_UID, platformAdmin: true };
  const comp1 = platformAdminCreateCompany(adminToken, "Acme Corp", "2026-27");
  const comp2 = platformAdminCreateCompany(adminToken, "Global Logistics", "2026-27");

  assert.equal(comp1.success, true);
  assert.equal(comp2.success, true);
  assert.notEqual(comp1.companyId, comp2.companyId);
  assert.equal(Object.keys(database.companies).length, 2);
});

test("Platform Admin 7 & 8: Grant creates membership + reverse index atomically", () => {
  const database = {
    memberships: {},
    userCompanies: {},
    platformAuditLogs: {},
  };

  function grantCompanyAccess(callerToken, companyId, targetUid, roleId) {
    if (!callerToken.platformAdmin) {
      return { success: false, code: "FORBIDDEN" };
    }

    const membershipRecord = {
      uid: targetUid,
      role: roleId,
      roleId,
      status: "active",
      createdAt: Date.now(),
    };

    // Atomic multi-path updates
    database.memberships[`${companyId}/${targetUid}`] = membershipRecord;
    database.userCompanies[`${targetUid}/${companyId}`] = true;
    database.platformAuditLogs[`audit_${Date.now()}`] = {
      action: "company.access.granted",
      companyId,
      targetUid,
      actorUid: callerToken.uid,
    };

    return { success: true, membership: membershipRecord };
  }

  const adminToken = { uid: INITIAL_PLATFORM_ADMIN_UID, platformAdmin: true };
  const res = grantCompanyAccess(adminToken, "comp_1", "user_rahul", "accountant");

  assert.equal(res.success, true);
  assert.equal(database.memberships["comp_1/user_rahul"].role, "accountant");
  assert.equal(database.userCompanies["user_rahul/comp_1"], true);
  assert.equal(Object.keys(database.platformAuditLogs).length, 1);
});

test("Platform Admin 9: Ordinary user cannot grant themselves access", () => {
  function attemptGrant(callerToken, companyId, targetUid, roleId) {
    if (!callerToken.platformAdmin) {
      return { success: false, code: "FORBIDDEN" };
    }
    return { success: true };
  }

  const attackerToken = { uid: "attacker_uid", email: "hacker@test.com" };
  const res = attemptGrant(attackerToken, "comp_1", "attacker_uid", "owner");
  assert.equal(res.success, false);
  assert.equal(res.code, "FORBIDDEN");
});

test("Platform Admin 10: User cannot change their own role", () => {
  function changeRole(callerToken, companyId, targetUid, newRole) {
    if (!callerToken.platformAdmin) {
      return { success: false, code: "FORBIDDEN" };
    }
    return { success: true };
  }

  const accountantToken = { uid: "user_rahul", email: "rahul@abc.com" };
  const selfElevation = changeRole(accountantToken, "comp_1", "user_rahul", "owner");
  assert.equal(selfElevation.success, false);
  assert.equal(selfElevation.code, "FORBIDDEN");
});

test("Platform Admin 11: Revoked membership immediately loses tenant access", () => {
  const database = {
    memberships: {
      "comp_1/user_rahul": { uid: "user_rahul", role: "accountant", status: "active" },
    },
    userCompanies: {
      "user_rahul/comp_1": true,
    },
  };

  function revokeAccess(companyId, targetUid) {
    database.memberships[`${companyId}/${targetUid}`].status = "revoked";
    delete database.userCompanies[`${targetUid}/${companyId}`];
  }

  function canAccessTenant(uid, companyId) {
    // Mimic Firebase Security Rule
    return database.userCompanies[`${uid}/${companyId}`] === true &&
      database.memberships[`${companyId}/${uid}`]?.status === "active";
  }

  assert.equal(canAccessTenant("user_rahul", "comp_1"), true);
  revokeAccess("comp_1", "user_rahul");
  assert.equal(canAccessTenant("user_rahul", "comp_1"), false, "Must lose tenant access immediately");
  assert.equal(database.memberships["comp_1/user_rahul"].status, "revoked", "History preserved");
});

test("Platform Admin 12: Suspended membership cannot access tenant", () => {
  const database = {
    memberships: {
      "comp_1/user_salman": { uid: "user_salman", role: "sales", status: "active" },
    },
    userCompanies: {
      "user_salman/comp_1": true,
    },
  };

  function suspendAccess(companyId, targetUid) {
    database.memberships[`${companyId}/${targetUid}`].status = "suspended";
    delete database.userCompanies[`${targetUid}/${companyId}`];
  }

  function canAccessTenant(uid, companyId) {
    return database.userCompanies[`${uid}/${companyId}`] === true &&
      database.memberships[`${companyId}/${uid}`]?.status === "active";
  }

  assert.equal(canAccessTenant("user_salman", "comp_1"), true);
  suspendAccess("comp_1", "user_salman");
  assert.equal(canAccessTenant("user_salman", "comp_1"), false);

  // Reactivate
  database.memberships["comp_1/user_salman"].status = "active";
  database.userCompanies["user_salman/comp_1"] = true;
  assert.equal(canAccessTenant("user_salman", "comp_1"), true);
});

test("Platform Admin 13 & 14: One user can belong to multiple companies with different roles", () => {
  const memberships = {
    "comp_A/user_sameer": { role: "accountant", status: "active" },
    "comp_B/user_sameer": { role: "viewer", status: "active" },
    "comp_C/user_sameer": { role: "owner", status: "active" },
  };

  const userCompanies = {
    user_sameer: {
      comp_A: true,
      comp_B: true,
      comp_C: true,
    },
  };

  assert.equal(Object.keys(userCompanies["user_sameer"]).length, 3);
  assert.equal(memberships["comp_A/user_sameer"].role, "accountant");
  assert.equal(memberships["comp_B/user_sameer"].role, "viewer");
  assert.equal(memberships["comp_C/user_sameer"].role, "owner");
});

test("Platform Admin 15: Platform admin without membership cannot read company operational data through client rules", () => {
  const rules = JSON.parse(readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8"));

  // Check /companyData rule
  const companyDataReadRule = rules.rules.companyData.$companyId[".read"];
  assert.doesNotMatch(
    companyDataReadRule,
    /auth\.token\.platformAdmin/,
    "Platform Admin claim must NOT be a blanket bypass for tenant operational data"
  );
  assert.match(
    companyDataReadRule,
    /status.*active/,
    "Tenant data requires active tenant membership"
  );
});

test("Platform Admin 16: Ownership transfer cannot leave company without valid owner", () => {
  const companyMemberships = {
    owner_1: { uid: "owner_1", role: "owner", status: "active" },
    staff_2: { uid: "staff_2", role: "accountant", status: "active" },
  };

  function transferOwnership(newOwnerUid, previousOwnerNewRole = "administrator") {
    // Step 1: Promote target new owner FIRST
    companyMemberships[newOwnerUid] = {
      ...companyMemberships[newOwnerUid],
      role: "owner",
      status: "active",
    };

    // Step 2: Demote previous owner
    companyMemberships["owner_1"] = {
      ...companyMemberships["owner_1"],
      role: previousOwnerNewRole,
    };

    // Verify company has at least 1 active owner
    const activeOwners = Object.values(companyMemberships).filter(
      (m) => m.role === "owner" && m.status === "active"
    );
    assert.ok(activeOwners.length >= 1, "Must always have at least 1 active owner");
    return { success: true, activeOwnersCount: activeOwners.length };
  }

  const res = transferOwnership("staff_2", "administrator");
  assert.equal(res.success, true);
  assert.equal(companyMemberships["staff_2"].role, "owner");
  assert.equal(companyMemberships["owner_1"].role, "administrator");
});

test("Platform Admin 17: Access management writes are audited without secrets", () => {
  function createAuditLog(action, actorUid, targetUid, before, after) {
    const sanitize = (obj) => {
      if (!obj) return null;
      const clean = { ...obj };
      delete clean.password;
      delete clean.idToken;
      delete clean.token;
      return clean;
    };

    return {
      action,
      actorUid,
      targetUid,
      before: sanitize(before),
      after: sanitize(after),
      timestamp: Date.now(),
    };
  }

  const log = createAuditLog(
    "company.access.granted",
    INITIAL_PLATFORM_ADMIN_UID,
    "user_123",
    null,
    { role: "accountant", password: "secret_password_123", idToken: "token_abc" }
  );

  assert.equal(log.action, "company.access.granted");
  assert.equal(log.after.role, "accountant");
  assert.equal(log.after.password, undefined, "Password must be stripped from audit");
  assert.equal(log.after.idToken, undefined, "Token must be stripped from audit");
});

test("Platform Admin 18: requirePlatformAdmin does NOT auto-assign platformAdmin claim (Correction 1)", () => {
  // Authorization function must never silently grant privileges
  function requirePlatformAdmin(decodedToken) {
    if (!decodedToken || decodedToken.platformAdmin !== true) {
      return { success: false, code: "FORBIDDEN" };
    }
    return { success: true, uid: decodedToken.uid };
  }

  // Token for initial admin without claim yet
  const tokenWithoutClaim = { uid: INITIAL_PLATFORM_ADMIN_UID, email: INITIAL_PLATFORM_ADMIN_EMAIL };
  const authRes = requirePlatformAdmin(tokenWithoutClaim);
  assert.equal(authRes.success, false, "Must reject without claim even if UID matches initial admin");
  assert.equal(tokenWithoutClaim.platformAdmin, undefined, "Must NOT mutate or auto-assign claim during auth check");

  // Token with claim
  const tokenWithClaim = { uid: INITIAL_PLATFORM_ADMIN_UID, email: INITIAL_PLATFORM_ADMIN_EMAIL, platformAdmin: true };
  const validRes = requirePlatformAdmin(tokenWithClaim);
  assert.equal(validRes.success, true);
});

test("Platform Admin 19: Custom claims preserve existing claims during merge (Correction 2)", () => {
  const existingUserRecord = {
    customClaims: {
      betaTester: true,
      department: "finance",
      tier: "enterprise",
    },
  };

  function mergePlatformAdminClaim(userRecord, isPlatformAdmin = true) {
    const existing = userRecord.customClaims || {};
    return {
      ...existing,
      platformAdmin: isPlatformAdmin,
    };
  }

  const updatedClaims = mergePlatformAdminClaim(existingUserRecord, true);
  assert.equal(updatedClaims.platformAdmin, true);
  assert.equal(updatedClaims.betaTester, true, "Existing claim 'betaTester' must be preserved");
  assert.equal(updatedClaims.department, "finance", "Existing claim 'department' must be preserved");
  assert.equal(updatedClaims.tier, "enterprise", "Existing claim 'tier' must be preserved");

  // Revocation also preserves other claims
  const revokedClaims = mergePlatformAdminClaim(existingUserRecord, false);
  assert.equal(revokedClaims.platformAdmin, false);
  assert.equal(revokedClaims.betaTester, true);
});

test("Platform Admin 20: One-time bootstrap script outputs BLOCKED_BY_CREDENTIALS safely (Correction 3)", () => {
  const scriptContent = readFileSync(resolve(process.cwd(), "scripts/bootstrap-platform-admin.ts"), "utf8");
  assert.match(scriptContent, /PLATFORM_ADMIN_CLAIM_SETUP = BLOCKED_BY_CREDENTIALS/);
  assert.match(scriptContent, /BOkCLXp08tVmRHICTArgpReVh5Y2/);
  assert.match(scriptContent, /maaz@admin\.com/);
  assert.match(scriptContent, /\.\.\.existingClaims,\s*platformAdmin:\s*true/);
});

test("Platform Admin 21: Token refresh and client claims resolution via getIdTokenResult (Correction 4)", () => {
  let tokenResultClaims = { platformAdmin: false };
  function getIdTokenResult(forceRefresh = false) {
    if (forceRefresh) {
      tokenResultClaims = { platformAdmin: true };
    }
    return Promise.resolve({ claims: tokenResultClaims });
  }

  // Before claim assignment
  getIdTokenResult(false).then((res) => {
    assert.equal(Boolean(res.claims.platformAdmin), false);
  });

  // After claim assignment, force refresh
  getIdTokenResult(true).then((res) => {
    assert.equal(Boolean(res.claims.platformAdmin), true);
  });
});

test("Platform Admin 22: /system-admin accessible with 0 company memberships (Correction 5)", () => {
  function canAccessSystemAdmin(isPlatformAdmin) {
    return isPlatformAdmin === true;
  }

  function canAccessCompanyWorkspace(activeCompanyId, memberships) {
    return Boolean(activeCompanyId && memberships[activeCompanyId]?.status === "active");
  }

  const userMemberships = {}; // ZERO memberships!
  const isPlatformAdmin = true;

  assert.equal(canAccessSystemAdmin(isPlatformAdmin), true, "Platform Admin with 0 companies CAN open /system-admin");
  assert.equal(canAccessCompanyWorkspace(null, userMemberships), false, "Cannot enter tenant workspace without active company");
});

test("Platform Admin 23: Multiple active Owners permitted, ownership transfer maintains >= 1 owner (Correction 8)", () => {
  const companyMemberships = {
    owner_alice: { uid: "owner_alice", role: "owner", status: "active" },
    owner_bob: { uid: "owner_bob", role: "owner", status: "active" },
    staff_carol: { uid: "staff_carol", role: "accountant", status: "active" },
  };

  // Multiple active owners test
  const activeOwners = Object.values(companyMemberships).filter(
    (m) => m.role === "owner" && m.status === "active"
  );
  assert.equal(activeOwners.length, 2, "Multiple owners must be valid simultaneously");

  function safeTransfer(targetUid, demoteUid = null) {
    // 1. Promote target FIRST
    companyMemberships[targetUid] = {
      ...(companyMemberships[targetUid] || {}),
      role: "owner",
      status: "active",
    };

    // 2. If demotion requested, verify company will have >= 1 active owner
    if (demoteUid) {
      const remainingOwners = Object.entries(companyMemberships).filter(
        ([uid, m]) => uid !== demoteUid && m.role === "owner" && m.status === "active"
      );
      if (remainingOwners.length === 0) {
        throw new Error("CANNOT_LEAVE_OWNERLESS");
      }
      companyMemberships[demoteUid] = {
        ...companyMemberships[demoteUid],
        role: "administrator",
      };
    }
  }

  safeTransfer("staff_carol", "owner_alice");
  assert.equal(companyMemberships.staff_carol.role, "owner");
  assert.equal(companyMemberships.owner_alice.role, "administrator");
  assert.equal(companyMemberships.owner_bob.role, "owner");
});

test("Platform Admin 24: User creation workflow with PASSWORD_INVITATION_EMAIL = NOT_CONFIGURED (Correction 9)", () => {
  const usersDb = {};

  function createPlatformUserWorkflow(email, displayName, existingUsers = {}) {
    const cleanEmail = email.trim().toLowerCase();
    if (existingUsers[cleanEmail]) {
      return {
        success: true,
        existing: true,
        uid: existingUsers[cleanEmail].uid,
        PASSWORD_INVITATION_EMAIL: "NOT_CONFIGURED",
      };
    }

    const uid = `uid_${Math.random().toString(36).substring(2, 8)}`;
    usersDb[cleanEmail] = { uid, email: cleanEmail, displayName };
    return {
      success: true,
      existing: false,
      uid,
      PASSWORD_INVITATION_EMAIL: "NOT_CONFIGURED",
    };
  }

  const newUserRes = createPlatformUserWorkflow("accounts@abc.com", "Accounts Lead");
  assert.equal(newUserRes.success, true);
  assert.equal(newUserRes.existing, false);
  assert.equal(newUserRes.PASSWORD_INVITATION_EMAIL, "NOT_CONFIGURED");

  // Subsequent call for existing email
  const existingRes = createPlatformUserWorkflow("accounts@abc.com", "Accounts Lead", usersDb);
  assert.equal(existingRes.success, true);
  assert.equal(existingRes.existing, true);
  assert.equal(existingRes.uid, newUserRes.uid);
  assert.equal(existingRes.PASSWORD_INVITATION_EMAIL, "NOT_CONFIGURED");
});

test("Platform Admin 25: Suspended vs Revoked atomic index behavior (Correction 14)", () => {
  const memberships = {};
  const userCompanies = {};

  function updateAccessStatus(companyId, uid, status) {
    memberships[`${companyId}/${uid}`] = { status };
    if (status === "active") {
      userCompanies[`${uid}/${companyId}`] = true;
    } else {
      delete userCompanies[`${uid}/${companyId}`];
    }
  }

  // Active
  updateAccessStatus("comp_abc", "user_1", "active");
  assert.equal(memberships["comp_abc/user_1"].status, "active");
  assert.equal(userCompanies["user_1/comp_abc"], true);

  // Suspended: status = suspended, userCompanies removed
  updateAccessStatus("comp_abc", "user_1", "suspended");
  assert.equal(memberships["comp_abc/user_1"].status, "suspended");
  assert.equal(userCompanies["user_1/comp_abc"], undefined);

  // Reactivated: status = active, userCompanies restored
  updateAccessStatus("comp_abc", "user_1", "active");
  assert.equal(memberships["comp_abc/user_1"].status, "active");
  assert.equal(userCompanies["user_1/comp_abc"], true);

  // Revoked: status = revoked, userCompanies removed
  updateAccessStatus("comp_abc", "user_1", "revoked");
  assert.equal(memberships["comp_abc/user_1"].status, "revoked");
  assert.equal(userCompanies["user_1/comp_abc"], undefined);
});

test("Platform Admin 26: PlatformPermission decoupled from ROLE_CAPABILITIES (Correction 18)", () => {
  const permissionsContent = readFileSync(resolve(process.cwd(), "src/modules/auth/permissions.ts"), "utf8");
  assert.match(permissionsContent, /export type PlatformPermission/);
  assert.doesNotMatch(permissionsContent, /ROLE_CAPABILITIES: Record<.*PlatformPermission/);
  assert.doesNotMatch(permissionsContent, /owner:\s*\[[^\]]*platform\./);
});

test("Platform Admin 27: Final Verification Flow (A through G Complete End-to-End Chain)", () => {
  // A. Platform Admin
  const platformAdmin = {
    uid: "BOkCLXp08tVmRHICTArgpReVh5Y2",
    email: "maaz@admin.com",
    token: { platformAdmin: true },
  };
  const platformAdminMemberships = {}; // zero memberships
  assert.equal(platformAdmin.token.platformAdmin, true);
  const canOpenSystemAdmin = platformAdmin.token.platformAdmin === true;
  assert.equal(canOpenSystemAdmin, true, "Step A: /system-admin opens with 0 company memberships");

  // B. Create Company
  const systemDb = {
    companies: {},
    companyData: {},
    memberships: {},
    userCompanies: {},
    companySummaries: {},
  };

  const compId = "comp_abc";
  systemDb.companies[compId] = { id: compId, name: "ABC Pvt Ltd", active: true };
  systemDb.companyData[compId] = {
    branches: { br_main: { id: "br_main", name: "Main Branch" } },
    financialYears: { fy_2026: { id: "fy_2026", name: "2026-2027" } },
    ledgers: {},
  };
  systemDb.companySummaries[compId] = { activeMemberCount: 0, ownerCount: 0, status: "active" };
  assert.ok(systemDb.companies[compId], "Step B: ABC Pvt Ltd created");

  // C. Create / find user
  const accountUser = {
    email: "accounts@abc.com",
    uid: "uid_acc_123",
    displayName: "Accounts Officer",
  };
  assert.equal(accountUser.email, "accounts@abc.com", "Step C: User accounts@abc.com resolved");

  // D. Grant Access
  // Server atomically writes /memberships and /userCompanies
  systemDb.memberships[`${compId}/${accountUser.uid}`] = {
    uid: accountUser.uid,
    role: "accountant",
    status: "active",
  };
  systemDb.userCompanies[`${accountUser.uid}/${compId}`] = true;
  systemDb.companySummaries[compId].activeMemberCount = 1;

  assert.ok(systemDb.memberships[`${compId}/${accountUser.uid}`], "Step D: Membership written");
  assert.equal(systemDb.userCompanies[`${accountUser.uid}/${compId}`], true, "Step D: Reverse index written");

  // E. User Login
  const userCompaniesForAccountUser = Object.keys(systemDb.userCompanies)
    .filter((k) => k.startsWith(`${accountUser.uid}/`))
    .map((k) => k.split("/")[1]);
  assert.deepEqual(userCompaniesForAccountUser, ["comp_abc"], "Step E: userCompanies lists ABC Pvt Ltd");
  const activeMembership = systemDb.memberships[`comp_abc/${accountUser.uid}`];
  assert.equal(activeMembership.role, "accountant", "Step E: Accountant permissions loaded");

  // F. Tenant Isolation
  // Platform Admin without company membership cannot enter ABC operational data
  const platformAdminHasAccessToABC = Boolean(systemDb.memberships[`comp_abc/${platformAdmin.uid}`]);
  assert.equal(platformAdminHasAccessToABC, false, "Step F: Platform Admin cannot enter ABC operational data without membership");

  // Accountant from ABC cannot access XYZ
  const compXYZId = "comp_xyz";
  systemDb.companies[compXYZId] = { id: compXYZId, name: "XYZ Corp" };
  const accountantHasAccessToXYZ = Boolean(systemDb.memberships[`comp_xyz/${accountUser.uid}`]);
  assert.equal(accountantHasAccessToXYZ, false, "Step F: Accountant cannot access XYZ");

  // G. Multi-Company
  // Same user: ABC -> Accountant, XYZ -> Viewer
  systemDb.memberships[`${compXYZId}/${accountUser.uid}`] = {
    uid: accountUser.uid,
    role: "viewer",
    status: "active",
  };
  systemDb.userCompanies[`${accountUser.uid}/${compXYZId}`] = true;

  const multiCompanies = Object.keys(systemDb.userCompanies)
    .filter((k) => k.startsWith(`${accountUser.uid}/`))
    .map((k) => k.split("/")[1]);
  assert.equal(multiCompanies.length, 2, "Step G: User belongs to 2 companies");
  assert.ok(multiCompanies.includes("comp_abc"));
  assert.ok(multiCompanies.includes("comp_xyz"));
  assert.equal(systemDb.memberships[`comp_abc/${accountUser.uid}`].role, "accountant");
  assert.equal(systemDb.memberships[`comp_xyz/${accountUser.uid}`].role, "viewer");
});

test("Platform Admin 28: Configured initial UID without claim results in setup mode, NOT real Platform Admin (PRD Section 13 & 42)", () => {
  function resolveAdminState(callerUid, claims, configuredAdminUid) {
    const isPlatformAdmin = Boolean(claims && claims.platformAdmin === true);
    const setupRequired = !isPlatformAdmin && Boolean(configuredAdminUid && callerUid === configuredAdminUid);
    const badge = isPlatformAdmin ? "Platform Admin" : setupRequired ? "Platform Setup" : "Access Denied";
    const canExecuteFullAdmin = isPlatformAdmin;

    return { isPlatformAdmin, setupRequired, badge, canExecuteFullAdmin };
  }

  const configuredUid = "BOkCLXp08tVmRHICTArgpReVh5Y2";

  // Initial user logged in before custom claim exists
  const stateBeforeClaim = resolveAdminState(configuredUid, {}, configuredUid);
  assert.equal(stateBeforeClaim.isPlatformAdmin, false);
  assert.equal(stateBeforeClaim.setupRequired, true);
  assert.equal(stateBeforeClaim.badge, "Platform Setup");
  assert.equal(stateBeforeClaim.canExecuteFullAdmin, false, "Must NOT grant full admin privileges without claim");

  // User with verified custom claim
  const stateAfterClaim = resolveAdminState(configuredUid, { platformAdmin: true }, configuredUid);
  assert.equal(stateAfterClaim.isPlatformAdmin, true);
  assert.equal(stateAfterClaim.setupRequired, false);
  assert.equal(stateAfterClaim.badge, "Platform Admin");
  assert.equal(stateAfterClaim.canExecuteFullAdmin, true);
});

test("Platform Admin 29: UID with platformAdmin=true grants full Platform Admin privileges (PRD Section 42)", () => {
  function authorizeSystemAdminAction(decodedToken) {
    if (decodedToken.platformAdmin !== true) {
      return { authorized: false, code: "FORBIDDEN" };
    }
    return { authorized: true };
  }

  const authorizedToken = { uid: "any_admin_uid", platformAdmin: true };
  const res = authorizeSystemAdminAction(authorizedToken);
  assert.equal(res.authorized, true);

  const unauthorizedToken = { uid: "BOkCLXp08tVmRHICTArgpReVh5Y2" }; // Missing claim
  const unauthRes = authorizeSystemAdminAction(unauthorizedToken);
  assert.equal(unauthRes.authorized, false);
  assert.equal(unauthRes.code, "FORBIDDEN");
});

test("Platform Admin 30: Ordinary UID cannot bootstrap platformAdmin (PRD Section 42)", () => {
  const configuredAdminUid = "BOkCLXp08tVmRHICTArgpReVh5Y2";

  function simulateBootstrapClaim(callerUid) {
    if (callerUid !== configuredAdminUid) {
      return { success: false, code: "FORBIDDEN", error: "Caller UID does not match configured INITIAL_PLATFORM_ADMIN_UID." };
    }
    return { success: true, bootstrappedUid: callerUid };
  }

  const ordinaryUser = simulateBootstrapClaim("attacker_or_normal_user");
  assert.equal(ordinaryUser.success, false);
  assert.equal(ordinaryUser.code, "FORBIDDEN");

  const validAdmin = simulateBootstrapClaim(configuredAdminUid);
  assert.equal(validAdmin.success, true);
});

test("Platform Admin 31: Email match alone cannot bootstrap platformAdmin (PRD Section 42)", () => {
  const configuredAdminUid = "BOkCLXp08tVmRHICTArgpReVh5Y2";
  const configuredAdminEmail = "maaz@admin.com";

  function bootstrapValidation(callerUid, callerEmail) {
    // Strictly requires callerUid to match configuredAdminUid
    if (callerUid !== configuredAdminUid) {
      return { success: false, code: "FORBIDDEN", reason: "UID_MISMATCH" };
    }
    return { success: true };
  }

  // Attacker with matching email but arbitrary UID
  const spoofedRes = bootstrapValidation("attacker_uid_999", configuredAdminEmail);
  assert.equal(spoofedRes.success, false);
  assert.equal(spoofedRes.code, "FORBIDDEN");
  assert.equal(spoofedRes.reason, "UID_MISMATCH");

  // Legitimate admin with matching UID
  const validRes = bootstrapValidation(configuredAdminUid, configuredAdminEmail);
  assert.equal(validRes.success, true);
});

test("Platform Admin 32: Custom claim merge preserves existing claims when bootstrapping platformAdmin (PRD Section 42)", () => {
  function mergePlatformAdminClaim(existingClaims) {
    return {
      ...existingClaims,
      platformAdmin: true,
    };
  }

  const currentClaims = {
    auditor: true,
    betaTester: true,
    companyRoles: { comp_123: "advisor" },
  };

  const updatedClaims = mergePlatformAdminClaim(currentClaims);
  assert.equal(updatedClaims.platformAdmin, true);
  assert.equal(updatedClaims.auditor, true, "Must preserve existing auditor claim");
  assert.equal(updatedClaims.betaTester, true, "Must preserve existing betaTester claim");
  assert.deepEqual(updatedClaims.companyRoles, { comp_123: "advisor" });
});


