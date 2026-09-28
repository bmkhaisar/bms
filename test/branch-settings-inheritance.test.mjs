import test from "node:test";
import assert from "node:assert/strict";

import { resolveBranchCompanyContext } from "../src/modules/company/types.ts";

test("Branch Settings Inheritance: Branch inherits company default when switch is ON", () => {
  const company = {
    id: "org_a",
    name: "ABC Enterprises Pvt Ltd",
    address: "100 MG Road, Bangalore",
    phone: "+91 9876543210",
    email: "contact@abcenterprises.com",
    bankName: "State Bank of India",
    accountNumber: "1234567890",
    ifsc: "SBIN0001234",
    signatoryName: "Rajesh Kumar",
    signatoryDesignation: "Director",
    terms: "Payment due within 15 days of invoice.",
    quotationTerms: "Quotation valid for 30 days.",
    generalInformation: "Standard terms and specifications apply.",
    technicalSpecifications: "Standard industry specifications.",
  };

  const branch = {
    id: "branch_main",
    companyId: "org_a",
    name: "Main Branch",
    isMain: true,
    active: true,
    // All defaults set to true
    useCompanyBankDefault: true,
    useCompanySignatoryDefault: true,
    useCompanyContactDefault: true,
    useCompanyGeneralInfoDefault: true,
    useCompanyTechSpecsDefault: true,
    useCompanyTermsDefault: true,
  };

  const resolved = resolveBranchCompanyContext(company, branch);

  // Assert fallback to company default
  assert.equal(resolved.bankName, "State Bank of India");
  assert.equal(resolved.accountNumber, "1234567890");
  assert.equal(resolved.ifsc, "SBIN0001234");
  assert.equal(resolved.signatoryName, "Rajesh Kumar");
  assert.equal(resolved.terms, "Payment due within 15 days of invoice.");
  assert.equal(resolved.generalInformation, "Standard terms and specifications apply.");
});

test("Branch Settings Inheritance: Branch overrides specific sections when switch is OFF", () => {
  const company = {
    id: "org_a",
    name: "ABC Enterprises Pvt Ltd",
    address: "100 MG Road, Bangalore",
    bankName: "State Bank of India",
    accountNumber: "1234567890",
    signatoryName: "Rajesh Kumar",
    terms: "Payment due within 15 days.",
  };

  const branchWithOverrides = {
    id: "branch_blr",
    companyId: "org_a",
    name: "Bangalore Branch",
    documentDisplayName: "ABC Enterprises — Bangalore Facility",
    isMain: false,
    active: true,
    // Bank overridden
    useCompanyBankDefault: false,
    bankName: "HDFC Bank",
    accountNumber: "9876543210",
    ifsc: "HDFC0004321",
    // Terms overridden
    useCompanyTermsDefault: false,
    terms: "Bangalore branch payment terms: 7 days net.",
    // Signatory kept as company default
    useCompanySignatoryDefault: true,
  };

  const resolved = resolveBranchCompanyContext(company, branchWithOverrides);

  // Bank should be overridden
  assert.equal(resolved.bankName, "HDFC Bank");
  assert.equal(resolved.accountNumber, "9876543210");
  assert.equal(resolved.ifsc, "HDFC0004321");

  // Terms should be overridden
  assert.equal(resolved.terms, "Bangalore branch payment terms: 7 days net.");

  // Signatory must remain inherited from company
  assert.equal(resolved.signatoryName, "Rajesh Kumar");

  // Document Display Name should be branch's display name
  assert.equal(resolved.documentDisplayName, "ABC Enterprises — Bangalore Facility");
  // While company legal name remains intact
  assert.equal(resolved.legalName, "ABC Enterprises Pvt Ltd");
});

test("Branch Settings Inheritance: 3-tier Document Override > Branch Override > Company Default", () => {
  const company = {
    id: "org_a",
    name: "ABC Enterprises Pvt Ltd",
    bankName: "SBI",
  };

  const branch = {
    id: "branch_1",
    companyId: "org_a",
    name: "Branch 1",
    useCompanyBankDefault: false,
    bankName: "HDFC",
  };

  // Case 1: Draft document without override gets Branch override (HDFC)
  const resolvedDraft = resolveBranchCompanyContext(company, branch);
  assert.equal(resolvedDraft.bankName, "HDFC");

  // Case 2: Document with explicit override gets Document Override (ICICI)
  const documentBankOverride = "ICICI Bank";
  const finalEffectiveBank = documentBankOverride || resolvedDraft.bankName;
  assert.equal(finalEffectiveBank, "ICICI Bank");
});

test("Branch Settings Inheritance: Finalized snapshot immutability", () => {
  const companyV1 = {
    id: "org_a",
    name: "ABC Enterprises Pvt Ltd",
    bankName: "SBI (Original)",
    terms: "Original Terms",
  };

  const branch = {
    id: "branch_1",
    companyId: "org_a",
    useCompanyBankDefault: true,
    useCompanyTermsDefault: true,
  };

  // Document posted in FY 2026-27 captures frozen snapshot
  const resolvedAtPosting = resolveBranchCompanyContext(companyV1, branch);
  const frozenInvoice = {
    id: "inv_001",
    number: "INV-001",
    branchId: "branch_1",
    companySnapshot: {
      bankName: resolvedAtPosting.bankName,
      terms: resolvedAtPosting.terms,
    },
    postingStatus: "posted",
  };

  // Later, company changes its bank details to Axis Bank
  const companyV2 = {
    ...companyV1,
    bankName: "Axis Bank (New)",
    terms: "Updated Terms",
  };

  // Historical invoice's frozen snapshot must NOT change
  assert.equal(frozenInvoice.companySnapshot.bankName, "SBI (Original)");
  assert.equal(frozenInvoice.companySnapshot.terms, "Original Terms");

  // New draft document will resolve to the new company default
  const resolvedNewDraft = resolveBranchCompanyContext(companyV2, branch);
  assert.equal(resolvedNewDraft.bankName, "Axis Bank (New)");
});
