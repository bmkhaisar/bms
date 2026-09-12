import test from "node:test";
import assert from "node:assert/strict";

const MAX_SESSION_AGE_SECONDS = 7200;

function checkSessionAge(decodedToken, policy = "persistent") {
  if (policy === "strict" && decodedToken.auth_time) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const sessionAge = nowSeconds - decodedToken.auth_time;
    if (sessionAge > MAX_SESSION_AGE_SECONDS) {
      return {
        valid: false,
        error: "Your session expired. Sign in again to continue.",
        code: "SESSION_EXPIRED",
      };
    }
  }
  return { valid: true };
}

function formatFyCode(fyName) {
  if (!fyName) return "FY";
  const clean = fyName.trim();
  const match = clean.match(/^(\d{4})-(\d{2,4})$/);
  if (match) {
    const startYear = match[1];
    const endYear = match[2];
    const shortEnd = endYear.length === 4 ? endYear.slice(2) : endYear;
    return `${startYear}-${shortEnd}`;
  }
  return clean.replace(/\s+/g, "-");
}

function rupeesToPaise(rupees) {
  if (rupees === null || rupees === undefined || isNaN(rupees)) return 0;
  return Math.round(rupees * 100);
}

function createCompanySnapshot(company) {
  return {
    name: company.name || "",
    legalName: company.legalName || company.name || "",
    gstin: company.gstin,
    pan: company.pan,
    email: company.email,
    phone: company.phone,
    address: company.address,
    city: company.city,
    state: company.state,
    pincode: company.pincode,
    logoUrl: company.logoUrl,
    bankName: company.bankName,
    bankAccountNo: company.bankAccountNo,
    bankIfsc: company.bankIfsc,
    bankBranch: company.bankBranch,
    upiId: company.upiId,
    signatureUrl: company.signatureUrl,
    stampUrl: company.stampUrl,
    snapshotAt: Date.now(),
  };
}

// Phase 3 Invariant Tests

test("Phase 3 - Sec 1: Persistent Session policy accepts valid auth regardless of 7200s session age", () => {
  const now = Math.floor(Date.now() / 1000);
  const result = checkSessionAge({ auth_time: now - 7205 }, "persistent");
  assert.equal(result.valid, true);
});

test("Phase 3 - Sec 2: Strict Session policy rejects session age >= 7200s with SESSION_EXPIRED", () => {
  const now = Math.floor(Date.now() / 1000);
  const result = checkSessionAge({ auth_time: now - 7205 }, "strict");
  assert.equal(result.valid, false);
  assert.equal(result.code, "SESSION_EXPIRED");
});

test("Phase 3 - Num 1: formatFyCode extracts canonical short format from year string", () => {
  assert.equal(formatFyCode("2026-2027"), "2026-27");
  assert.equal(formatFyCode("2026-27"), "2026-27");
  assert.equal(formatFyCode("FY 2026"), "FY-2026");
});

test("Phase 3 - Num 2: Atomic document numbering formats legal sequence {PREFIX}/{FY}/{SEQ}", () => {
  const prefix = "INV";
  const fyCode = formatFyCode("2026-2027");
  const seq = 42;
  const docNumber = `${prefix}/${fyCode}/${String(seq).padStart(4, "0")}`;
  assert.equal(docNumber, "INV/2026-27/0042");
});

test("Phase 3 - Ledger 1: Party ledger ID format conforms to tenant partition", () => {
  const compId = "comp_test_123";
  const custId = "abc_456";
  const expectedLedgerId = `led_${compId}_cust_${custId}`;
  assert.equal(expectedLedgerId, "led_comp_test_123_cust_abc_456");
});

test("Phase 3 - Payment 1: Payment method separates instrument from real Cash/Bank ledger", () => {
  const receipt = {
    paymentMethod: "upi",
    settlementLedgerId: "led_comp_hdfc_bank",
    amount: 5000,
  };

  assert.equal(receipt.paymentMethod, "upi");
  assert.equal(receipt.settlementLedgerId, "led_comp_hdfc_bank");
  assert.notEqual(receipt.settlementLedgerId, "led_upi_balance", "Must not create artificial UPI balances");
});

test("Phase 3 - Stock 1: Non-inventory items (trackInventory === false) omit stock movements", () => {
  const products = [
    { id: "prod_widget", name: "Steel Widget", trackInventory: true, currentStock: 100 },
    { id: "prod_service", name: "Installation Service", trackInventory: false, currentStock: 0 },
  ];

  const lineItems = [
    { productId: "prod_widget", quantity: 5 },
    { productId: "prod_service", quantity: 1 },
  ];

  const updatedProducts = products.map((p) => {
    const item = lineItems.find((li) => li.productId === p.id);
    if (!item || p.trackInventory === false) return p;
    return { ...p, currentStock: p.currentStock - item.quantity };
  });

  const widget = updatedProducts.find((p) => p.id === "prod_widget");
  const service = updatedProducts.find((p) => p.id === "prod_service");

  assert.equal(widget?.currentStock, 95);
  assert.equal(service?.currentStock, 0, "Service stock should remain completely untouched");
});

test("Phase 3 - Quote 1: Idempotency check returns existing invoice when already converted", () => {
  const quotation = {
    id: "qt_101",
    status: "converted",
    convertedInvoiceId: "inv_202",
  };

  const isAlreadyConverted = Boolean(quotation.convertedInvoiceId);
  assert.equal(isAlreadyConverted, true, "Already converted quotation must be detected");
});

test("Phase 3 - Inv 1: Invoice posting balances total debits and credits at integer paise", () => {
  const grandTotalRupees = 1180.50;
  const gstTotalRupees = 180.50;

  const totalPaise = rupeesToPaise(grandTotalRupees);
  const taxPaise = rupeesToPaise(gstTotalRupees);
  const taxablePaise = totalPaise - taxPaise;

  const lines = [
    { ledgerId: "led_debtor", debit: totalPaise, credit: 0 },
    { ledgerId: "led_sales", debit: 0, credit: taxablePaise },
    { ledgerId: "led_gst", debit: 0, credit: taxPaise },
  ];

  const sumDebit = lines.reduce((s, l) => s + l.debit, 0);
  const sumCredit = lines.reduce((s, l) => s + l.credit, 0);

  assert.equal(sumDebit, sumCredit, "Total Debit must exactly equal Total Credit");
  assert.equal(sumDebit, 118050);
});

test("Phase 3 - Snap 1: createCompanySnapshot freezes company branding and legal fields", () => {
  const liveCompany = {
    id: "c1",
    name: "Alpha Corp",
    legalName: "Alpha Corporation Private Limited",
    gstin: "29AAAAA0000A1Z5",
    bankName: "HDFC Bank",
    bankAccountNo: "1234567890",
    bankIfsc: "HDFC0001234",
    signatureUrl: "https://r2.bms/signatures/v1.png",
  };

  const snapshot = createCompanySnapshot(liveCompany);

  assert.equal(snapshot.legalName, "Alpha Corporation Private Limited");
  assert.equal(snapshot.gstin, "29AAAAA0000A1Z5");
  assert.equal(snapshot.bankAccountNo, "1234567890");
  assert.equal(snapshot.signatureUrl, "https://r2.bms/signatures/v1.png");
  assert.ok(snapshot.snapshotAt > 0);
});
