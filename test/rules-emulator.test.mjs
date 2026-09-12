import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

/**
 * Real Firebase Security Rules Evaluator
 * Simulates Firebase Realtime Database Rule evaluation engine on database.rules.json
 * Implements Snapshot hierarchy, auth context, root, data, newData, and path matching.
 */

class DataSnapshot {
  constructor(data) {
    this._data = data;
  }

  val() {
    if (this._data === undefined) return null;
    return this._data;
  }

  exists() {
    return this._data !== undefined && this._data !== null;
  }

  child(path) {
    if (!this.exists() || typeof this._data !== "object") {
      return new DataSnapshot(null);
    }
    const parts = path.split("/").filter(Boolean);
    let curr = this._data;
    for (const part of parts) {
      if (curr && typeof curr === "object" && part in curr) {
        curr = curr[part];
      } else {
        return new DataSnapshot(null);
      }
    }
    return new DataSnapshot(curr);
  }

  hasChildren(children) {
    if (!this.exists() || typeof this._data !== "object") return false;
    return children.every((c) => c in this._data);
  }
}

class FirebaseRulesEngine {
  constructor(rulesFilePath) {
    const raw = readFileSync(rulesFilePath, "utf8");
    this.rawRules = JSON.parse(raw).rules;
  }

  evaluateRead(path, auth, rootDb) {
    const targetPath = path.startsWith("/") ? path.slice(1) : path;
    const ruleInfo = this._findRule(targetPath, ".read");
    if (!ruleInfo || ruleInfo.rule === false) return false;
    if (ruleInfo.rule === true) return true;

    return this._execRule(ruleInfo.rule, {
      auth,
      root: new DataSnapshot(rootDb),
      data: new DataSnapshot(rootDb).child(targetPath),
      ...ruleInfo.wildcards,
    });
  }

  evaluateWrite(path, auth, rootDb, newDataVal) {
    const targetPath = path.startsWith("/") ? path.slice(1) : path;
    const ruleInfo = this._findRule(targetPath, ".write");
    if (!ruleInfo || ruleInfo.rule === false) return false;
    if (ruleInfo.rule === true) return true;

    return this._execRule(ruleInfo.rule, {
      auth,
      root: new DataSnapshot(rootDb),
      data: new DataSnapshot(rootDb).child(targetPath),
      newData: new DataSnapshot(newDataVal),
      ...ruleInfo.wildcards,
    });
  }

  _execRule(ruleStr, sandboxVars) {
    if (typeof ruleStr !== "string") return Boolean(ruleStr);
    try {
      const rawAuth = sandboxVars.auth;
      const auth = rawAuth
        ? {
            uid: rawAuth.uid,
            token: {
              auth_time: Math.floor(Date.now() / 1000),
              ...(rawAuth.token || {}),
            },
            ...rawAuth,
          }
        : null;

      const context = vm.createContext({
        ...sandboxVars,
        now: Date.now(),
        auth,
        root: sandboxVars.root,
        data: sandboxVars.data,
        newData: sandboxVars.newData,
      });
      return Boolean(vm.runInContext(ruleStr, context));

    } catch {
      return false;
    }
  }


  _findRule(path, ruleKey) {
    const segments = path.split("/").filter(Boolean);
    let currNode = this.rawRules;
    const wildcards = {};

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (!currNode || typeof currNode !== "object") return null;

      // 1. Direct key match
      if (seg in currNode) {
        currNode = currNode[seg];
      } else {
        // 2. Wildcard key match (e.g. $companyId, $uid)
        const wildcardKey = Object.keys(currNode).find((k) => k.startsWith("$"));
        if (wildcardKey) {
          wildcards[wildcardKey] = seg;
          currNode = currNode[wildcardKey];
        } else {
          return null;
        }
      }
    }

    if (currNode && ruleKey in currNode) {
      return { rule: currNode[ruleKey], wildcards };
    }

    return null;
  }
}

// Instantiate engine with database.rules.json
const rulesEngine = new FirebaseRulesEngine(resolve(process.cwd(), "database.rules.json"));

// Mock Database State with two distinct tenants
const mockDatabase = {
  users: {
    user_A: { uid: "user_A", email: "userA@business.com", createdAt: 1000 },
    user_B: { uid: "user_B", email: "userB@business.com", createdAt: 1000 },
  },
  userCompanies: {
    user_A: { comp_A: true },
    user_B: { comp_B: true },
  },
  memberships: {
    comp_A: {
      user_A: { role: "owner", status: "active", createdAt: 1000 },
      user_inactive: { role: "viewer", status: "suspended", createdAt: 1000 },
    },
    comp_B: {
      user_B: { role: "owner", status: "active", createdAt: 1000 },
    },
  },
  companies: {
    comp_A: { id: "comp_A", name: "Alpha Ltd" },
    comp_B: { id: "comp_B", name: "Beta Corp" },
  },
  companyData: {
    comp_A: {
      customers: { c1: { name: "Client 1" } },
      products: { p1: { name: "Widget A" } },
      vouchers: { v1: { voucherNumber: "JV-1" } },
      stockMovements: { sm1: { quantity: 10 } },
      docCounters: { "2026-2027": { invoice: 1 } },
      auditLogs: { log1: { action: "create" } },
    },
    comp_B: {
      customers: { c2: { name: "Client 2" } },
    },
  },
};

const authUserA = { uid: "user_A", email: "userA@business.com" };
const authUserB = { uid: "user_B", email: "userB@business.com" };
const authInactiveUser = { uid: "user_inactive", email: "inactive@business.com" };

test("Emulator Rule 1: Unauthenticated requests are completely denied", () => {
  assert.equal(rulesEngine.evaluateRead("companies/comp_A", null, mockDatabase), false);
  assert.equal(rulesEngine.evaluateRead("companyData/comp_A", null, mockDatabase), false);
  assert.equal(rulesEngine.evaluateRead("memberships/comp_A", null, mockDatabase), false);
  assert.equal(rulesEngine.evaluateRead("userCompanies/user_A", null, mockDatabase), false);
  assert.equal(rulesEngine.evaluateWrite("companyData/comp_A/customers/c1", null, mockDatabase, { name: "Hack" }), false);
});

test("Emulator Rule 2: User A cannot read or write Company B data (Tenant Isolation)", () => {
  // Read isolation
  const canReadCompanyB = rulesEngine.evaluateRead("companies/comp_B", authUserA, mockDatabase);
  assert.equal(canReadCompanyB, false, "User A must not read Company B profile");

  const canReadCompanyBData = rulesEngine.evaluateRead("companyData/comp_B", authUserA, mockDatabase);
  assert.equal(canReadCompanyBData, false, "User A must not read Company B data");

  // Write isolation
  const canWriteCompanyB = rulesEngine.evaluateWrite("companies/comp_B", authUserA, mockDatabase, { name: "Hacked" });
  assert.equal(canWriteCompanyB, false, "User A must not write to Company B profile");

  const canWriteCustomerB = rulesEngine.evaluateWrite("companyData/comp_B/customers/c2", authUserA, mockDatabase, { name: "Hacked" });
  assert.equal(canWriteCustomerB, false, "User A must not write to Company B customers");
});

test("Emulator Rule 3: Client cannot write to /memberships (even active owners)", () => {
  const canWriteMembership = rulesEngine.evaluateWrite(
    "memberships/comp_A",
    authUserA,
    mockDatabase,
    { user_malicious: { role: "owner", status: "active" } }
  );
  assert.equal(canWriteMembership, false, "Client write to /memberships must be strictly blocked");
});

test("Emulator Rule 4: Client cannot write to /userCompanies index", () => {
  const canWriteUserCompanies = rulesEngine.evaluateWrite(
    "userCompanies/user_A",
    authUserA,
    mockDatabase,
    { comp_unauthorized: true }
  );
  assert.equal(canWriteUserCompanies, false, "Client write to /userCompanies must be strictly blocked");
});

test("Emulator Rule 5: Client cannot write directly to vouchers or stock movements", () => {
  const canWriteVoucher = rulesEngine.evaluateWrite(
    "companyData/comp_A/vouchers",
    authUserA,
    mockDatabase,
    { v2: { total: 1000 } }
  );
  assert.equal(canWriteVoucher, false, "Client write to vouchers must be blocked (server-only)");

  const canWriteStock = rulesEngine.evaluateWrite(
    "companyData/comp_A/stockMovements",
    authUserA,
    mockDatabase,
    { sm2: { qty: 50 } }
  );
  assert.equal(canWriteStock, false, "Client write to stockMovements must be blocked (server-only)");

  const canWriteCounters = rulesEngine.evaluateWrite(
    "companyData/comp_A/docCounters",
    authUserA,
    mockDatabase,
    { "2026-2027": { invoice: 999 } }
  );
  assert.equal(canWriteCounters, false, "Client write to docCounters must be blocked (server-only)");

  const canWriteAudit = rulesEngine.evaluateWrite(
    "companyData/comp_A/auditLogs",
    authUserA,
    mockDatabase,
    { log2: { action: "delete" } }
  );
  assert.equal(canWriteAudit, false, "Client write to auditLogs must be blocked (server-only)");
});

test("Emulator Rule 6: Active member can access allowed ordinary company operational data", () => {
  const canReadCompanyData = rulesEngine.evaluateRead("companyData/comp_A", authUserA, mockDatabase);
  assert.equal(canReadCompanyData, true, "Active member can read companyData");

  const canWriteCustomer = rulesEngine.evaluateWrite(
    "companyData/comp_A/customers",
    authUserA,
    mockDatabase,
    { c2: { name: "Acme Corp" } }
  );
  assert.equal(canWriteCustomer, true, "Active member can create/update customers");

  const canWriteProduct = rulesEngine.evaluateWrite(
    "companyData/comp_A/products",
    authUserA,
    mockDatabase,
    { p2: { name: "Gadget B" } }
  );
  assert.equal(canWriteProduct, true, "Active member can create/update products");
});

test("Emulator Rule 7: Removed or inactive/suspended membership immediately loses access", () => {
  // Inactive/suspended user attempts to read company data
  const canInactiveRead = rulesEngine.evaluateRead("companyData/comp_A", authInactiveUser, mockDatabase);
  assert.equal(canInactiveRead, false, "Suspended member must not read company data");

  const canInactiveWrite = rulesEngine.evaluateWrite(
    "companyData/comp_A/customers",
    authInactiveUser,
    mockDatabase,
    { c3: { name: "Blocked" } }
  );
  assert.equal(canInactiveWrite, false, "Suspended member must not write to company data");

  // Removed user (null membership)
  const unknownUser = { uid: "user_unknown" };
  const canUnknownRead = rulesEngine.evaluateRead("companyData/comp_A", unknownUser, mockDatabase);
  assert.equal(canUnknownRead, false, "Removed member must have zero access to company data");
});

test("Emulator Rule 8: Read privacy for /userCompanies and /memberships", () => {
  // /userCompanies/{uid} only readable by that uid
  assert.equal(rulesEngine.evaluateRead("userCompanies/user_A", authUserA, mockDatabase), true);
  assert.equal(rulesEngine.evaluateRead("userCompanies/user_B", authUserA, mockDatabase), false);

// /memberships/{companyId} only readable by active members of that company
  assert.equal(rulesEngine.evaluateRead("memberships/comp_A", authUserA, mockDatabase), true);
  assert.equal(rulesEngine.evaluateRead("memberships/comp_B", authUserA, mockDatabase), false);
  assert.equal(rulesEngine.evaluateRead("memberships/comp_A", authInactiveUser, mockDatabase), false);
});

test("Emulator Rule 9: Session < 2h (7190s) is accepted by RTDB rules", () => {
  const validAuth = {
    uid: "user_A",
    token: { auth_time: Math.floor(Date.now() / 1000) - 7190 },
  };
  const canRead = rulesEngine.evaluateRead("companyData/comp_A", validAuth, mockDatabase);
  assert.equal(canRead, true, "Valid session under 2 hours must be permitted");
});

test("Emulator Rule 10: Session > 2h (7210s) is strictly rejected by RTDB rules", () => {
  const expiredAuth = {
    uid: "user_A",
    token: { auth_time: Math.floor(Date.now() / 1000) - 7210 },
  };
  const canRead = rulesEngine.evaluateRead("companyData/comp_A", expiredAuth, mockDatabase);
  assert.equal(canRead, false, "Expired session (> 2 hours) must be strictly denied by RTDB rules");

  const canWrite = rulesEngine.evaluateWrite("companyData/comp_A/customers", expiredAuth, mockDatabase, {
    cNew: { name: "Expired Attempt" },
  });
  assert.equal(canWrite, false, "Expired session write must be strictly denied by RTDB rules");
});

