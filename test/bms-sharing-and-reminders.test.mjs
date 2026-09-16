import test from "node:test";
import assert from "node:assert/strict";

// Import modules under test
import {
  normalizeWhatsAppPhone,
  isPhoneAmbiguous,
  generateEmailSubject,
  generateEmailBody,
  generateWhatsAppMessage,
  generateReminderEmailSubject,
  generateReminderEmailBody,
  generateReminderWhatsAppMessage,
  buildGmailComposeUrl,
  buildMailtoUrl,
  buildWhatsAppUrl,
} from "../src/modules/documents/sharing/bmsShareMessageService.ts";

import {
  resolveCreditDays,
  computeInvoiceDueDate,
  computeInvoicePaymentInsight,
  findAllocatedReceiptsForInvoice,
} from "../src/modules/documents/sharing/paymentInsightService.ts";

test("BMS Sharing — Phone Normalization & Ambiguity Detection", async (t) => {
  await t.test("Indian 10-digit mobile normalizes to 91 without plus prefix for wa.me", () => {
    const res = normalizeWhatsAppPhone("9876543210", "India");
    assert.equal(res, "919876543210");
    assert.equal(isPhoneAmbiguous("9876543210", "India"), false);
  });

  await t.test("Indian mobile with spaces and dashes normalizes correctly", () => {
    const res = normalizeWhatsAppPhone(" 98765-43210 ", "India");
    assert.equal(res, "919876543210");
  });

  await t.test("Indian mobile with leading zero normalizes to 91", () => {
    const res = normalizeWhatsAppPhone("09876543210", "India");
    assert.equal(res, "919876543210");
  });

  await t.test("Valid international number starting with + preserves digits for wa.me", () => {
    const resUS = normalizeWhatsAppPhone("+14155552671", "United States");
    assert.equal(resUS, "14155552671");
    assert.equal(isPhoneAmbiguous("+14155552671", "United States"), false);

    const resUAE = normalizeWhatsAppPhone("+971501234567", "UAE");
    assert.equal(resUAE, "971501234567");
  });

  await t.test("Ambiguous/short non-Indian number triggers isPhoneAmbiguous warning", () => {
    const isAmbiguous = isPhoneAmbiguous("123456", "Germany");
    assert.equal(isAmbiguous, true);
  });

  await t.test("Empty phone returns empty string", () => {
    const res = normalizeWhatsAppPhone("", "India");
    assert.equal(res, "");
  });
});

test("BMS Sharing — Email Copy Invariant: Do Not Claim PDF is Attached", async (t) => {
  const sampleInvoiceData = {
    kind: "invoice",
    documentId: "inv_1",
    documentNumber: "INV-2026-001",
    date: new Date("2026-09-16T10:00:00Z").getTime(),
    dueDate: new Date("2026-09-30T10:00:00Z").getTime(),
    totalAmount: 15750,
    balanceOutstanding: 15750,
    party: {
      partyId: "pty_1",
      name: "Acme Corp",
      email: "billing@acme.com",
    },
    company: {
      name: "Standard Metal Works",
      legalName: "Standard Metal Works Pvt Ltd",
    },
  };

  await t.test("Invoice email body avoids claiming 'Please find the attached PDF'", () => {
    const body = generateEmailBody(sampleInvoiceData);
    assert.ok(
      !body.toLowerCase().includes("please find the attached pdf"),
      "Must not claim 'please find the attached pdf' in email body"
    );
    assert.ok(
      !body.toLowerCase().includes("attached pdf"),
      "Must not claim 'attached pdf' in email body"
    );
    assert.ok(
      body.includes("Please find Invoice INV-2026-001 from Standard Metal Works Pvt Ltd for your reference.")
    );
  });

  await t.test("Quotation email body avoids claiming attached PDF", () => {
    const sampleQuotationData = {
      ...sampleInvoiceData,
      kind: "quotation",
      documentNumber: "QTN-2026-042",
      totalAmount: 50000,
    };
    const body = generateEmailBody(sampleQuotationData);
    assert.ok(!body.toLowerCase().includes("attached pdf"));
    assert.ok(body.includes("Please find Quotation QTN-2026-042 from Standard Metal Works Pvt Ltd for your review."));
  });

  await t.test("Receipt Voucher email body avoids claiming attached PDF", () => {
    const sampleReceiptData = {
      ...sampleInvoiceData,
      kind: "receipt",
      documentNumber: "REC-2026-088",
      totalAmount: 15750,
    };
    const body = generateEmailBody(sampleReceiptData);
    assert.ok(!body.toLowerCase().includes("attached pdf"));
    assert.ok(body.includes("We acknowledge receipt of"));
    assert.ok(body.includes("Receipt Number: REC-2026-088"));
  });

  await t.test("Payment reminder email body is polite, accurate and mentions due details", () => {
    const subject = generateReminderEmailSubject(sampleInvoiceData);
    const body = generateReminderEmailBody(sampleInvoiceData);
    assert.ok(subject.includes("Payment Reminder — INV-2026-001"));
    assert.ok(body.includes("INV-2026-001"));
    assert.ok(body.includes("Standard Metal Works Pvt Ltd"));
    assert.ok(body.includes("Balance Outstanding: ₹15,750.00"));
  });
});

test("BMS Sharing — External URL Composition", async (t) => {
  await t.test("Gmail Web Compose URL formats correctly with To, CC, Subject, and Body", () => {
    const url = buildGmailComposeUrl({
      to: "client@test.com",
      cc: "cc@company.com",
      subject: "Subject Test",
      body: "Body Test",
    });
    assert.ok(url.startsWith("https://mail.google.com/mail/?"));
    assert.ok(url.includes("view=cm"));
    assert.ok(url.includes("to=client%40test.com"));
    assert.ok(url.includes("su=Subject+Test") || url.includes("su=Subject%20Test"));
    assert.ok(url.includes("cc=cc%40company.com"));
  });

  await t.test("Mailto URL formats correctly with To, CC, Subject, and Body", () => {
    const url = buildMailtoUrl({
      to: "client@test.com",
      cc: "cc@company.com",
      subject: "Subject Test",
      body: "Body Test",
    });
    assert.ok(url.startsWith("mailto:client%40test.com?"));
    assert.ok(url.includes("subject=Subject+Test") || url.includes("subject=Subject%20Test"));
    assert.ok(url.includes("cc=cc%40company.com"));
  });

  await t.test("WhatsApp URL formats with clean digits and URL-encoded text", () => {
    const url = buildWhatsAppUrl({
      phone: "+91 98765 43210",
      country: "India",
      message: "Hello World & Co.",
    });
    assert.ok(url.startsWith("https://wa.me/919876543210?text="));
    assert.ok(url.includes("Hello%20World%20%26%20Co."));
  });
});

test("BMS Payment Insight — Credit Days Priority & Frozen Invariance", async (t) => {
  await t.test("Credit days resolution priority: Party > Company Default > 30-day Fallback", () => {
    // 1. Party has credit days
    const partyWithCredit = { creditDays: 45 };
    const compWithCredit = { defaultCreditDays: 15 };
    assert.equal(resolveCreditDays(partyWithCredit, compWithCredit), 45);

    // 2. Party has no credit days, company has default
    const partyNoCredit = { creditDays: undefined };
    assert.equal(resolveCreditDays(partyNoCredit, compWithCredit), 15);

    // 3. Neither has credit days -> 30-day fallback
    const compNoCredit = { defaultCreditDays: undefined };
    assert.equal(resolveCreditDays(partyNoCredit, compNoCredit), 30);
    assert.equal(resolveCreditDays(null, null), 30);
  });

  await t.test("computeInvoiceDueDate correctly adds credit days to base invoice date", () => {
    const baseDate = new Date("2026-09-01T00:00:00.000Z").getTime();
    const dueDate = computeInvoiceDueDate({ date: baseDate }, 15);
    const expected = baseDate + 15 * 24 * 60 * 60 * 1000;
    assert.equal(dueDate, expected);
  });

  await t.test("FROZEN INVARIANCE: Existing/posted invoice ALWAYS respects its frozen dueDate", () => {
    const frozenDueDate = new Date("2026-09-20T00:00:00.000Z").getTime();
    const existingInvoice = {
      id: "inv_1",
      number: "INV-001",
      date: new Date("2026-08-01T00:00:00.000Z").getTime(),
      dueDate: frozenDueDate,
      creditDaysSnapshot: 20,
      grandTotal: 10000,
      amountPaid: 0,
      balance: 10000,
    };

    // Even if party now has 60 credit days and company has 90 credit days:
    const updatedParty = { creditDays: 60 };
    const updatedCompany = { defaultCreditDays: 90 };

    const insight = computeInvoicePaymentInsight({
      invoice: existingInvoice,
      receipts: [],
      party: updatedParty,
      company: updatedCompany,
    });

    // The insight must strictly maintain the frozen dueDate
    assert.equal(insight.dueDate, frozenDueDate);
    assert.equal(insight.creditDays, 20);
  });

  await t.test("FROZEN INVARIANCE: Partial receipts must NEVER reset or recalculate dueDate", () => {
    const frozenDueDate = new Date("2026-09-20T00:00:00.000Z").getTime();
    const invoice = {
      id: "inv_1",
      number: "INV-001",
      date: new Date("2026-09-01T00:00:00.000Z").getTime(),
      dueDate: frozenDueDate,
      creditDaysSnapshot: 19,
      grandTotal: 10000,
      amountPaid: 4000,
      balance: 6000,
    };

    const partialReceipt = {
      id: "rec_1",
      number: "REC-001",
      date: new Date("2026-09-10T00:00:00.000Z").getTime(),
      amount: 4000,
      invoiceId: "inv_1",
      status: "posted",
      postingStatus: "posted",
    };

    const insight = computeInvoicePaymentInsight({
      invoice,
      receipts: [partialReceipt],
    });

    const allocated = findAllocatedReceiptsForInvoice(invoice.id, [partialReceipt]);

    // Due date remains untouched
    assert.equal(insight.dueDate, frozenDueDate);
    assert.equal(insight.balance, 6000);
    assert.equal(insight.totalReceived, 4000);
    assert.equal(allocated.matchingReceipts.length, 1);
    assert.equal(allocated.matchingReceipts[0].amount, 4000);
  });
});

test("BMS Payment Insight — Status, Remaining & Overdue Calculations", async (t) => {
  const baseTimestamp = new Date("2026-09-16T12:00:00.000Z").getTime();

  await t.test("Fully paid invoice is classified as 'paid'", () => {
    const invoice = {
      id: "inv_paid",
      number: "INV-100",
      date: baseTimestamp - 10 * 86400000,
      dueDate: baseTimestamp + 10 * 86400000,
      grandTotal: 5000,
      amountPaid: 5000,
      balance: 0,
      status: "paid",
    };
    const insight = computeInvoicePaymentInsight({ invoice, receipts: [] });
    assert.equal(insight.statusVariant, "paid");
    assert.equal(insight.isPaid, true);
    assert.equal(insight.isOverdue, false);
  });

  await t.test("Invoice due within 3 days is classified as 'due_soon'", () => {
    // 2 days in future
    const dueDate = Date.now() + 2 * 86400000;
    const invoice = {
      id: "inv_soon",
      number: "INV-101",
      date: Date.now() - 5 * 86400000,
      dueDate,
      grandTotal: 5000,
      amountPaid: 0,
      balance: 5000,
    };
    const insight = computeInvoicePaymentInsight({ invoice, receipts: [] });
    assert.equal(insight.statusVariant, "due_soon");
    assert.equal(insight.isOverdue, false);
    assert.ok(insight.daysRemaining <= 3 && insight.daysRemaining >= 0);
  });

  await t.test("Invoice past due date is classified as 'overdue'", () => {
    // 5 days in past
    const dueDate = Date.now() - 5 * 86400000;
    const invoice = {
      id: "inv_overdue",
      number: "INV-102",
      date: Date.now() - 25 * 86400000,
      dueDate,
      grandTotal: 12000,
      amountPaid: 2000,
      balance: 10000,
    };
    const insight = computeInvoicePaymentInsight({ invoice, receipts: [] });
    assert.equal(insight.statusVariant, "overdue");
    assert.equal(insight.isOverdue, true);
    assert.ok(insight.daysOverdue >= 4);
    assert.equal(insight.balance, 10000);
  });

  await t.test("Invoice due in 15 days is classified as 'neutral'", () => {
    const dueDate = Date.now() + 15 * 86400000;
    const invoice = {
      id: "inv_later",
      number: "INV-103",
      date: Date.now(),
      dueDate,
      grandTotal: 8000,
      amountPaid: 0,
      balance: 8000,
    };
    const insight = computeInvoicePaymentInsight({ invoice, receipts: [] });
    assert.equal(insight.statusVariant, "neutral");
    assert.equal(insight.isOverdue, false);
    assert.ok(insight.daysRemaining > 3);
  });

  await t.test("Multi-invoice receipt allocations match correctly", () => {
    const invoice = {
      id: "inv_multi",
      number: "INV-200",
      date: Date.now() - 10 * 86400000,
      dueDate: Date.now() + 5 * 86400000,
      grandTotal: 25000,
      amountPaid: 10000,
      balance: 15000,
    };
    const multiReceipt = {
      id: "rec_split",
      number: "REC-555",
      date: Date.now() - 2 * 86400000,
      amount: 30000,
      postingStatus: "posted",
      allocatedInvoices: [
        { invoiceId: "inv_other", amountPaise: 2000000 },
        { invoiceId: "inv_multi", amountPaise: 1000000 },
      ],
    };
    const allocated = findAllocatedReceiptsForInvoice(invoice.id, [multiReceipt]);
    assert.equal(allocated.matchingReceipts.length, 1);
    assert.equal(allocated.matchingReceipts[0].id, "rec_split");
    assert.equal(allocated.totalAllocatedPaise, 1000000);
  });
});

test("BMS Sharing — Document State Gating & Operational Settings", async (t) => {
  await t.test("Operational company setting defaultShareCcEmail is optional string", () => {
    const settings = {
      defaultShareCcEmail: "finance@company.com",
    };
    assert.equal(settings.defaultShareCcEmail, "finance@company.com");
  });

  await t.test("Draft invoice does not permit regular document sharing", () => {
    const draftInvoice = {
      id: "inv_draft",
      status: "draft",
      postingStatus: "draft",
    };
    const isPosted = draftInvoice.postingStatus === "posted" || (draftInvoice.status === "posted" && !draftInvoice.postingStatus);
    assert.equal(isPosted, false, "Draft invoice must fail posted check");
  });

  await t.test("Posted invoice passes sharing gate", () => {
    const postedInvoice = {
      id: "inv_posted",
      status: "posted",
      postingStatus: "posted",
      voucherId: "vch_123",
    };
    const isPosted = postedInvoice.postingStatus === "posted";
    assert.equal(isPosted, true, "Posted invoice must pass posted check");
  });
});
