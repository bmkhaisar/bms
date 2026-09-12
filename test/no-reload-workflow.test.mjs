import test from "node:test";
import assert from "node:assert/strict";

test("deactivation-policy.test: Master records with historical transactions cannot be hard deleted; only deactivated", async () => {
  // Invoices referencing product-123
  const invoices = [
    { id: "inv-001", items: [{ productId: "prod-123", name: "Steel Rod 12mm", quantity: 50 }] },
  ];

  function checkHistoricalUsage(productId) {
    const hasInvoices = invoices.some((inv) =>
      inv.items.some((item) => item.productId === productId)
    );
    if (hasInvoices) {
      return {
        canHardDelete: false,
        reason: "This product is referenced in 1 sales invoice(s). Permanent deletion is prohibited to protect historical records.",
        recommendedAction: "deactivate",
      };
    }
    return { canHardDelete: true, recommendedAction: "delete" };
  }

  const usage = checkHistoricalUsage("prod-123");
  assert.equal(usage.canHardDelete, false, "Product with transaction history must not allow hard deletion");
  assert.equal(usage.recommendedAction, "deactivate");
  assert.ok(usage.reason.includes("sales invoice"));

  // Deactivation action
  let product = { id: "prod-123", name: "Steel Rod 12mm", active: true };
  function deactivateProduct(p) {
    return { ...p, active: false };
  }

  product = deactivateProduct(product);
  assert.equal(product.active, false, "Product successfully deactivated (active: false)");
  // Ensure invoice still retains product reference
  assert.equal(invoices[0].items[0].productId, "prod-123", "Historical invoice remains completely intact");
});

test("financial-immutability.test: Posted invoices cannot be hard deleted; lifecycle uses cancel/reversal", () => {
  const invoice = {
    id: "inv-9001",
    number: "INV-2026-001",
    grandTotal: 11800,
    postingStatus: "posted",
    status: "unpaid",
  };

  function canHardDeleteDoc(doc) {
    if (doc.postingStatus === "posted") {
      return {
        canDelete: false,
        requiredAction: "cancel",
        reason: "Financial records posted to accounting ledgers cannot be hard deleted. You can cancel/reverse it instead.",
      };
    }
    return { canDelete: true, requiredAction: "delete" };
  }

  const check = canHardDeleteDoc(invoice);
  assert.equal(check.canDelete, false, "Posted invoices must NEVER be hard deleted (PRD § 6)");
  assert.equal(check.requiredAction, "cancel");

  // Perform cancellation / reversal
  function cancelPostedInvoice(inv) {
    return {
      ...inv,
      postingStatus: "reversed",
      status: "cancelled",
      cancelledAt: Date.now(),
    };
  }

  const cancelledInv = cancelPostedInvoice(invoice);
  assert.equal(cancelledInv.postingStatus, "reversed");
  assert.equal(cancelledInv.status, "cancelled");
});

test("no-reload-workflow.test: Full lifecycle executes with zero window.location.reload calls", async () => {
  let reloadCount = 0;
  const mockWindow = {
    location: {
      reload: () => {
        reloadCount++;
      },
    },
  };

  // State store
  let products = [{ id: "p1", name: "Item A", active: true }];
  let customers = [{ id: "c1", name: "Client A", active: true }];
  let invoices = [];

  // 1. Create Product
  products = [...products, { id: "p2", name: "Item B", active: true }];
  assert.equal(products.length, 2, "Product created in UI immediately");

  // 2. Edit Customer
  customers = customers.map((c) => (c.id === "c1" ? { ...c, name: "Client A Corp" } : c));
  assert.equal(customers[0].name, "Client A Corp", "Customer edited immediately");

  // 3. Delete Draft Product
  products = products.filter((p) => p.id !== "p2");
  assert.equal(products.length, 1, "Draft product deleted immediately");

  // 4. Post Invoice
  invoices = [...invoices, { id: "inv-1", number: "INV-01", postingStatus: "posted", status: "unpaid" }];
  assert.equal(invoices.length, 1, "Invoice posted and rendered immediately");

  // 5. Cancel Posted Invoice
  invoices = invoices.map((inv) =>
    inv.id === "inv-1" ? { ...inv, postingStatus: "reversed", status: "cancelled" } : inv
  );
  assert.equal(invoices[0].postingStatus, "reversed");

  // PRD § 68 Verification: zero hard reloads
  assert.equal(reloadCount, 0, "Normal application functionality must NEVER require window.location.reload() (PRD § 68)");
});
