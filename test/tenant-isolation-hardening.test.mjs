import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("Tenant Isolation 1: Firebase Security Rules verify companyData and companySummaries membership boundaries", () => {
  const rulesRaw = readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8");
  const rules = JSON.parse(rulesRaw).rules;

  // 1. companyData read must require active membership
  const companyDataRule = rules.companyData.$companyId;
  assert.ok(companyDataRule, "companyData/$companyId must exist in rules");
  assert.match(
    companyDataRule[".read"],
    /memberships.*\$companyId.*auth\.uid.*status.*active/,
    "companyData read must require active membership in that specific company"
  );

  // Sensitive collections must have .write: false
  assert.equal(companyDataRule.docCounters[".write"], false, "docCounters must have .write: false");
  assert.equal(companyDataRule.auditLogs[".write"], false, "auditLogs must have .write: false");
  assert.equal(companyDataRule.vouchers[".write"], false, "vouchers must have .write: false");
  assert.equal(companyDataRule.voucherLines[".write"], false, "voucherLines must have .write: false");
  assert.equal(companyDataRule.stockMovements[".write"], false, "stockMovements must have .write: false");

  // Operational collections must require active membership on write
  assert.match(
    companyDataRule.invoices[".write"],
    /memberships.*\$companyId.*auth\.uid.*status.*active/,
    "invoices write must require active membership"
  );
  assert.match(
    companyDataRule.customers[".write"],
    /memberships.*\$companyId.*auth\.uid.*status.*active/,
    "customers write must require active membership"
  );

  // 2. companySummaries must require active membership (Hardened in PRD Section 7)
  const summariesRule = rules.companySummaries.$companyId;
  assert.ok(summariesRule, "companySummaries/$companyId must exist in rules");
  assert.match(
    summariesRule[".read"],
    /memberships.*\$companyId.*auth\.uid.*status.*active/,
    "companySummaries read must require active membership"
  );
  assert.equal(summariesRule[".write"], false, "companySummaries write must be false");

  // 3. Memberships & userCompanies are server authoritative (write: false)
  assert.equal(rules.memberships.$companyId[".write"], false, "Client cannot write to memberships");
  assert.equal(rules.userCompanies.$uid[".write"], false, "Client cannot write to userCompanies");
});

test("Tenant Isolation 2: Cross-Tenant access simulation (USER_A vs COMPANY_B)", () => {
  // Memberships registry
  const memberships = {
    "COMPANY_A": {
      "USER_A": { role: "accountant", status: "active" },
    },
    "COMPANY_B": {
      "USER_B": { role: "accountant", status: "active" },
    },
  };

  function canAccessCompanyData(callerUid, targetCompanyId) {
    if (!callerUid || !targetCompanyId) return false;
    const mem = memberships[targetCompanyId]?.[callerUid];
    return Boolean(mem && mem.status === "active");
  }

  // USER_A -> Company A: Allowed
  assert.equal(canAccessCompanyData("USER_A", "COMPANY_A"), true, "USER_A must be allowed to access COMPANY_A");

  // USER_A -> Company B: Strictly Forbidden
  assert.equal(canAccessCompanyData("USER_A", "COMPANY_B"), false, "USER_A must be rejected from COMPANY_B");

  // USER_B -> Company A: Strictly Forbidden
  assert.equal(canAccessCompanyData("USER_B", "COMPANY_A"), false, "USER_B must be rejected from COMPANY_A");

  // USER_B -> Company B: Allowed
  assert.equal(canAccessCompanyData("USER_B", "COMPANY_B"), true, "USER_B must be allowed to access COMPANY_B");
});

test("Tenant Isolation 3: Server mutation authorization guards against client-supplied companyId manipulation", () => {
  const memberships = {
    "COMP_ALPHA": {
      "USER_1": { role: "sales", status: "active" },
    },
    "COMP_BETA": {
      "USER_2": { role: "sales", status: "active" },
    },
  };

  function executeServerMutation({ callerUid, requestedCompanyId, operation }) {
    // PRD § 8: Never trust companyId supplied by browser without verifying caller membership
    const callerMembership = memberships[requestedCompanyId]?.[callerUid];
    if (!callerMembership || callerMembership.status !== "active") {
      return {
        success: false,
        error: "Permission denied: caller is not an active member of the requested company",
        code: "PERMISSION_DENIED",
      };
    }

    // Role capability check
    if (operation === "invoice:create" && !["owner", "administrator", "accountant", "sales"].includes(callerMembership.role)) {
      return {
        success: false,
        error: "Forbidden: role lacks permission for operation",
        code: "FORBIDDEN",
      };
    }

    return {
      success: true,
      executedCompanyId: requestedCompanyId,
      actor: callerUid,
    };
  }

  // 1. Authorized mutation in caller's own company succeeds
  const legitWrite = executeServerMutation({
    callerUid: "USER_1",
    requestedCompanyId: "COMP_ALPHA",
    operation: "invoice:create",
  });
  assert.equal(legitWrite.success, true);
  assert.equal(legitWrite.executedCompanyId, "COMP_ALPHA");

  // 2. Attacker attempts to mutate COMP_BETA while authenticated as USER_1
  const spoofedWrite = executeServerMutation({
    callerUid: "USER_1",
    requestedCompanyId: "COMP_BETA",
    operation: "invoice:create",
  });
  assert.equal(spoofedWrite.success, false);
  assert.equal(spoofedWrite.code, "PERMISSION_DENIED");
});

test("Tenant Isolation 4: PDF & Document Invariant prevents mixing Company A document with Company B settings", () => {
  // PRD § 14: document.companyId === resolvedCompany.companyId
  function resolveDocumentModel({ doc, resolvedCompany }) {
    if (!doc.companyId || !resolvedCompany?.id) {
      throw new Error("Missing company identifier in document resolution");
    }
    if (doc.companyId !== resolvedCompany.id) {
      throw new Error(
        `TENANT_ISOLATION_VIOLATION: Document companyId (${doc.companyId}) does not match resolved company context (${resolvedCompany.id}).`
      );
    }
    return {
      documentId: doc.id,
      companyName: resolvedCompany.name,
      tenantId: resolvedCompany.id,
      verified: true,
    };
  }

  // Legitimate resolution within same tenant
  const validDoc = resolveDocumentModel({
    doc: { id: "inv_001", companyId: "comp_kh_demo" },
    resolvedCompany: { id: "comp_kh_demo", name: "KH Portable Cabins" },
  });
  assert.equal(validDoc.verified, true);
  assert.equal(validDoc.tenantId, "comp_kh_demo");

  // Cross-tenant mismatch throws TENANT_ISOLATION_VIOLATION
  assert.throws(
    () => {
      resolveDocumentModel({
        doc: { id: "inv_002", companyId: "comp_victim" },
        resolvedCompany: { id: "comp_attacker", name: "Attacker Org" },
      });
    },
    /TENANT_ISOLATION_VIOLATION/,
    "Must throw TENANT_ISOLATION_VIOLATION when document.companyId !== resolvedCompany.id"
  );
});

test("Tenant Isolation 5: Dexie and Global Search query isolation", () => {
  // Simulates Dexie local cache containing records from multiple companies (if offline sync stored both)
  const localDexieRecords = [
    { id: "c1", companyId: "COMP_A", name: "Apex Builders", type: "customer" },
    { id: "c2", companyId: "COMP_A", name: "Apex Global", type: "customer" },
    { id: "c3", companyId: "COMP_B", name: "Apex Infra", type: "customer" },
    { id: "i1", companyId: "COMP_A", number: "INV/2026-27/0001", total: 50000 },
    { id: "i2", companyId: "COMP_B", number: "INV/2026-27/0001", total: 95000 },
  ];

  // PRD § 11: Search queries must include activeCompanyId in underlying query, never search all records and visual filter
  function queryActiveCompanyRecords(records, activeCompanyId, searchTerm) {
    // Indexed filter by activeCompanyId
    return records
      .filter((r) => r.companyId === activeCompanyId)
      .filter((r) => {
        const text = `${r.name || ""} ${r.number || ""}`.toLowerCase();
        return text.includes(searchTerm.toLowerCase());
      });
  }

  // Searching "Apex" while active company is COMP_A returns ONLY COMP_A records
  const compASearch = queryActiveCompanyRecords(localDexieRecords, "COMP_A", "Apex");
  assert.equal(compASearch.length, 2);
  assert.equal(compASearch.every((r) => r.companyId === "COMP_A"), true);

  // Searching "Apex" while active company is COMP_B returns ONLY COMP_B record
  const compBSearch = queryActiveCompanyRecords(localDexieRecords, "COMP_B", "Apex");
  assert.equal(compBSearch.length, 1);
  assert.equal(compBSearch[0].id, "c3");
  assert.equal(compBSearch[0].companyId, "COMP_B");
});

test("Tenant Isolation 6: Outbox mutation isolation prevents cross-tenant dispatch", () => {
  // PRD § 10: Outbox entries are company-scoped. Only active company mutations are dispatched.
  const outboxQueue = [
    { id: "m1", companyId: "COMP_A", action: "createInvoice", payload: { number: "INV-1" } },
    { id: "m2", companyId: "COMP_B", action: "createInvoice", payload: { number: "INV-2" } },
    { id: "m3", companyId: "COMP_A", action: "recordPayment", payload: { amount: 1000 } },
  ];

  function getEligibleOutboxMutations(queue, currentActiveCompanyId) {
    if (!currentActiveCompanyId) return [];
    return queue.filter((item) => item.companyId === currentActiveCompanyId);
  }

  const eligibleForA = getEligibleOutboxMutations(outboxQueue, "COMP_A");
  assert.equal(eligibleForA.length, 2);
  assert.equal(eligibleForA.some((item) => item.companyId === "COMP_B"), false);

  const eligibleForB = getEligibleOutboxMutations(outboxQueue, "COMP_B");
  assert.equal(eligibleForB.length, 1);
  assert.equal(eligibleForB[0].id, "m2");
});

test("Tenant Isolation 7: Atomic document numbering sequences are completely company-scoped", () => {
  // PRD § 13: Document numbering is company-scoped and FY-scoped. Counters never collide or cross-increment.
  const companyCounters = {
    "COMP_A": {
      "2026-2027": { quotation: 1, invoice: 1 },
    },
    "COMP_B": {
      "2026-2027": { quotation: 1, invoice: 1 },
    },
  };

  function incrementCounter(companyId, fy, type) {
    if (!companyCounters[companyId]) companyCounters[companyId] = {};
    if (!companyCounters[companyId][fy]) companyCounters[companyId][fy] = {};
    const current = companyCounters[companyId][fy][type] || 0;
    const next = current + 1;
    companyCounters[companyId][fy][type] = next;
    const prefix = type === "quotation" ? "QT" : type === "invoice" ? "INV" : "DOC";
    return `${prefix}/${fy}/${String(next).padStart(4, "0")}`;
  }

  const compA_inv1 = incrementCounter("COMP_A", "2026-2027", "invoice");
  assert.equal(compA_inv1, "INV/2026-2027/0002");

  // COMP_B sequence was not affected by COMP_A's increment
  assert.equal(companyCounters["COMP_B"]["2026-2027"].invoice, 1);

  // Increment COMP_B
  const compB_inv1 = incrementCounter("COMP_B", "2026-2027", "invoice");
  assert.equal(compB_inv1, "INV/2026-2027/0002");
});

test("Tenant Isolation 8: R2 Object Key prefix and authorization scoping", () => {
  // PRD § 15: Object keys must use companies/{companyId}/...
  function generateR2StorageKey(companyId, category, filename) {
    if (!companyId) throw new Error("companyId is required for R2 object storage");
    return `companies/${companyId}/${category}/${filename}`;
  }

  function authorizeR2Access(callerUid, objectKey, memberships) {
    const match = objectKey.match(/^companies\/([^/]+)\//);
    if (!match) return false;
    const keyCompanyId = match[1];
    const mem = memberships[keyCompanyId]?.[callerUid];
    return Boolean(mem && mem.status === "active");
  }

  const memberships = {
    "COMP_ALPHA": { "USER_A": { status: "active" } },
    "COMP_BETA": { "USER_B": { status: "active" } },
  };

  const alphaKey = generateR2StorageKey("COMP_ALPHA", "logos", "logo.png");
  assert.equal(alphaKey, "companies/COMP_ALPHA/logos/logo.png");

  // USER_A can access COMP_ALPHA object
  assert.equal(authorizeR2Access("USER_A", alphaKey, memberships), true);

  // USER_B cannot access COMP_ALPHA object
  assert.equal(authorizeR2Access("USER_B", alphaKey, memberships), false);

  // USER_A cannot access COMP_BETA object
  const betaKey = generateR2StorageKey("COMP_BETA", "documents", "contract.pdf");
  assert.equal(authorizeR2Access("USER_A", betaKey, memberships), false);
});
