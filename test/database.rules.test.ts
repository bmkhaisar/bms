import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Automated Security Rules Verification Suite
 * Validates syntax, structure, and permission isolation of database.rules.json
 */
describe("Firebase Realtime Database Security Invariants", () => {
  let rulesJson: any;

  beforeAll(() => {
    const raw = readFileSync(resolve(process.cwd(), "database.rules.json"), "utf8");
    rulesJson = JSON.parse(raw).rules;
  });

  test("Root rules must disallow public access", () => {
    expect(rulesJson[".read"]).toBeUndefined();
    expect(rulesJson[".write"]).toBeUndefined();
  });

  test("Memberships tree cannot be written by clients", () => {
    expect(rulesJson.memberships.$companyId[".write"]).toBe(false);
  });

  test("userCompanies reverse index cannot be written by clients", () => {
    expect(rulesJson.userCompanies.$uid[".write"]).toBe(false);
  });

  test("Document sequence counters docCounters cannot be modified directly by clients", () => {
    expect(rulesJson.companyData.$companyId.docCounters[".write"]).toBe(false);
  });

  test("Audit logs cannot be tampered with or deleted by clients", () => {
    expect(rulesJson.companyData.$companyId.auditLogs[".write"]).toBe(false);
  });

  test("Vouchers and voucherLines require server-side posting", () => {
    expect(rulesJson.companyData.$companyId.vouchers[".write"]).toBe(false);
    expect(rulesJson.companyData.$companyId.voucherLines[".write"]).toBe(false);
  });

  test("Stock movements ledger cannot be written by arbitrary client calls", () => {
    expect(rulesJson.companyData.$companyId.stockMovements[".write"]).toBe(false);
  });

  test("CompanyData requires active membership for read", () => {
    const readRule = rulesJson.companyData.$companyId[".read"];
    expect(readRule).toContain("auth != null");
    expect(readRule).toContain("memberships");
    expect(readRule).toContain("active");
  });

  test("Queries have mandatory indexes defined", () => {
    const companyData = rulesJson.companyData.$companyId;
    expect(companyData.customers[".indexOn"]).toBeDefined();
    expect(companyData.products[".indexOn"]).toBeDefined();
    expect(companyData.invoices[".indexOn"]).toBeDefined();
    expect(companyData.financialYears[".indexOn"]).toBeDefined();
  });
});
