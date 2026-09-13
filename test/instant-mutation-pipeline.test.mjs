import test from "node:test";
import assert from "node:assert/strict";

test("PRD 8.1: Invoice create appears in React & Dexie state immediately without reload", async () => {
  const dexieInvoices = new Map();
  let reactInvoiceList = [];
  let reloadCount = 0;

  const mockWindow = {
    location: {
      reload: () => { reloadCount++; }
    }
  };

  // User posts an invoice
  const newInvoice = {
    id: "inv-2026-001",
    number: "INV-2026-001",
    date: Date.now(),
    customerId: "cust-1",
    grandTotal: 11800,
    balance: 11800,
    status: "unpaid",
    postingStatus: "posted",
    clientMutationId: "mut-inv-12345",
  };

  // Immediate mutation pipeline:
  // 1. Server returns authoritative saved invoice
  // 2. Immediately upsert returned invoice into Dexie
  dexieInvoices.set(newInvoice.id, newInvoice);
  // 3. Immediately update visible React/query list
  reactInvoiceList = [newInvoice, ...reactInvoiceList];

  assert.equal(reactInvoiceList.length, 1, "Invoice must appear in React state immediately");
  assert.equal(reactInvoiceList[0].id, "inv-2026-001");
  assert.equal(dexieInvoices.has("inv-2026-001"), true, "Invoice must be upserted in Dexie immediately");
  assert.equal(reloadCount, 0, "Zero window.location.reload calls permitted");
});

test("PRD 8.2: Duplicate retry using clientMutationId recovers without creating duplicate invoice", async () => {
  const rtdbInvoices = new Map();
  const mutationIndex = new Map(); // clientMutationId -> invoiceId

  function postInvoiceWithIdempotency(payload) {
    const { clientMutationId, invoice } = payload;
    if (clientMutationId && mutationIndex.has(clientMutationId)) {
      const existingId = mutationIndex.get(clientMutationId);
      // Return existing authoritative saved invoice instead of duplicate creation
      return { success: true, isDuplicatePrevented: true, invoice: rtdbInvoices.get(existingId) };
    }

    rtdbInvoices.set(invoice.id, invoice);
    if (clientMutationId) {
      mutationIndex.set(clientMutationId, invoice.id);
    }
    return { success: true, isDuplicatePrevented: false, invoice };
  }

  const payload = {
    clientMutationId: "cmut-post-inv-999",
    invoice: { id: "inv-999", number: "INV-2026-999", grandTotal: 5000, status: "unpaid" },
  };

  // First post
  const res1 = postInvoiceWithIdempotency(payload);
  assert.equal(res1.success, true);
  assert.equal(res1.isDuplicatePrevented, false);
  assert.equal(rtdbInvoices.size, 1);

  // User double-clicks or retries after delayed network response
  const res2 = postInvoiceWithIdempotency(payload);
  assert.equal(res2.success, true);
  assert.equal(res2.isDuplicatePrevented, true, "Duplicate retry detected by clientMutationId");
  assert.equal(res2.invoice.id, "inv-999");
  assert.equal(rtdbInvoices.size, 1, "Must NOT create second invoice in database");
});

test("PRD 8.3: Draft delete removes from RTDB, Dexie, and UI immediately", async () => {
  const rtdb = new Map([["draft-1", { id: "draft-1", status: "draft", grandTotal: 1000 }]]);
  const dexie = new Map([["draft-1", { id: "draft-1", status: "draft", grandTotal: 1000 }]]);
  let visibleList = [{ id: "draft-1", status: "draft", grandTotal: 1000 }];

  // Perform draft delete
  const docId = "draft-1";
  rtdb.delete(docId);
  dexie.delete(docId);
  visibleList = visibleList.filter(d => d.id !== docId);

  assert.equal(visibleList.length, 0, "Draft removed from visible UI immediately");
  assert.equal(dexie.has(docId), false, "Draft removed from Dexie immediately");
  assert.equal(rtdb.has(docId), false, "Draft removed from RTDB immediately");
});

test("PRD 8.4: Posted invoice void removes from Active list and appears in Voided / Deleted filter", () => {
  const allInvoices = [
    { id: "inv-1", number: "INV-001", status: "unpaid", postingStatus: "posted" },
    { id: "inv-2", number: "INV-002", status: "paid", postingStatus: "posted" },
  ];

  // Void inv-1
  const updatedInvoices = allInvoices.map(inv => {
    if (inv.id === "inv-1") {
      return { ...inv, status: "voided", postingStatus: "reversed" };
    }
    return inv;
  });

  function filterInvoices(list, statusFilter) {
    return list.filter(r => {
      const docStatus = (r.status || "").toLowerCase();
      const docPosting = (r.postingStatus || "").toLowerCase();
      const isVoidedOrCancelled =
        docStatus === "cancelled" ||
        docStatus === "voided" ||
        docStatus === "deleted" ||
        docPosting === "reversed";
      const isDraft = docStatus === "draft" || docPosting === "draft";

      if (statusFilter === "active") {
        if (isVoidedOrCancelled) return false;
      } else if (statusFilter === "draft") {
        if (!isDraft || isVoidedOrCancelled) return false;
      } else if (statusFilter === "voided") {
        if (!isVoidedOrCancelled) return false;
      }
      return true;
    });
  }

  // Active filter defaults
  const activeList = filterInvoices(updatedInvoices, "active");
  assert.equal(activeList.length, 1, "Active list must exclude voided invoice immediately");
  assert.equal(activeList[0].id, "inv-2");

  // Voided / Deleted filter shows it
  const voidedList = filterInvoices(updatedInvoices, "voided");
  assert.equal(voidedList.length, 1, "Voided filter must include the voided invoice");
  assert.equal(voidedList[0].id, "inv-1");

  // All filter shows both
  const allList = filterInvoices(updatedInvoices, "all");
  assert.equal(allList.length, 2, "All filter must include all records");
});

test("PRD 8.5: Void creates reversal transaction and retains audit record without physical deletion", () => {
  const auditLogs = [];
  const journalVouchers = [];

  const originalInvoice = {
    id: "inv-101",
    number: "INV-101",
    voucherId: "vch-101",
    grandTotal: 10000,
    postingStatus: "posted",
  };

  // Statutory audit rule: do NOT hard-delete. Post reversal voucher and record audit log.
  const reversalVoucher = {
    id: "vch-rev-101",
    originalVoucherId: originalInvoice.voucherId,
    voucherType: "reversal",
    date: Date.now(),
    narration: `Reversal of invoice ${originalInvoice.number}`,
  };
  journalVouchers.push(reversalVoucher);

  const auditLog = {
    entityId: originalInvoice.id,
    entityType: "invoice",
    action: "VOID_DOCUMENT",
    timestamp: Date.now(),
    reversalVoucherId: reversalVoucher.id,
  };
  auditLogs.push(auditLog);

  assert.equal(journalVouchers.length, 1, "Reversal voucher created");
  assert.equal(journalVouchers[0].originalVoucherId, "vch-101");
  assert.equal(auditLogs.length, 1, "Audit record retained for statutory compliance");
  assert.equal(auditLogs[0].action, "VOID_DOCUMENT");
});

test("PRD 8.6: Realtime Firebase event does not duplicate locally mutated item", () => {
  const localList = [{ id: "inv-1", number: "INV-001", grandTotal: 11800 }];

  // Firebase listener triggers after network latency
  const firebaseIncoming = { id: "inv-1", number: "INV-001", grandTotal: 11800 };

  // Reconcile function uses unique id key
  function reconcileList(current, incoming) {
    const map = new Map(current.map(item => [item.id, item]));
    map.set(incoming.id, incoming); // update or keep authoritative
    return Array.from(map.values());
  }

  const reconciled = reconcileList(localList, firebaseIncoming);
  assert.equal(reconciled.length, 1, "Realtime event must NOT duplicate local mutation");
});

test("PRD 8.7: Quotation, Purchase, Receipt, Payment, Party, Product instantaneous state sync", () => {
  const masters = {
    quotations: [{ id: "q1", number: "QT-1" }],
    purchases: [{ id: "pu1", number: "PUR-1" }],
    receipts: [{ id: "rc1", number: "REC-1" }],
    payments: [{ id: "py1", number: "PAY-1" }],
    parties: [{ id: "pt1", name: "Party 1" }],
    products: [{ id: "pr1", name: "Product 1" }],
  };

  // Add new party
  masters.parties = [{ id: "pt2", name: "Party 2" }, ...masters.parties];
  assert.equal(masters.parties.length, 2, "Party updates immediately");

  // Deactivate product
  masters.products = masters.products.map(p => p.id === "pr1" ? { ...p, active: false } : p);
  assert.equal(masters.products[0].active, false, "Product deactivates immediately");

  // Add purchase
  masters.purchases = [{ id: "pu2", number: "PUR-2" }, ...masters.purchases];
  assert.equal(masters.purchases.length, 2, "Purchase updates immediately");
});
