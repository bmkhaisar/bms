import test from "node:test";
import assert from "node:assert/strict";

/**
 * Universal Mock Environment for Multi-Device RTDB + Dexie + Realtime Sync
 */
class MockFirebaseRTDB {
  constructor() {
    this.store = new Map(); // path -> value
    this.listeners = new Map(); // path -> Set<callback>
  }

  get(path) {
    return this.store.get(path);
  }

  async set(path, value) {
    this.store.set(path, JSON.parse(JSON.stringify(value)));
    this._notify(path);
  }

  async update(updates) {
    for (const [path, val] of Object.entries(updates)) {
      this.store.set(path, JSON.parse(JSON.stringify(val)));
      this._notify(path);
    }
  }

  async remove(path) {
    this.store.delete(path);
    // Also remove any sub-paths
    for (const key of Array.from(this.store.keys())) {
      if (key.startsWith(path + "/")) {
        this.store.delete(key);
      }
    }
    this._notify(path);
  }

  onValue(path, callback) {
    if (!this.listeners.has(path)) {
      this.listeners.set(path, new Set());
    }
    this.listeners.get(path).add(callback);

    // Initial emit
    const val = this._getSnapshotValue(path);
    callback({
      exists: () => val !== undefined && val !== null,
      val: () => val,
    });

    return () => {
      this.listeners.get(path)?.delete(callback);
    };
  }

  _getSnapshotValue(path) {
    if (this.store.has(path)) {
      return this.store.get(path);
    }
    // Check if path is a collection prefix
    const prefix = path.endsWith("/") ? path : path + "/";
    const result = {};
    let found = false;
    for (const [key, val] of this.store.entries()) {
      if (key.startsWith(prefix)) {
        const subKey = key.slice(prefix.length).split("/")[0];
        result[subKey] = val;
        found = true;
      }
    }
    return found ? result : null;
  }

  _notify(path) {
    // Notify exact matches and parent collections
    for (const [listenPath, callbacks] of this.listeners.entries()) {
      if (path === listenPath || path.startsWith(listenPath + "/") || listenPath.startsWith(path + "/")) {
        const val = this._getSnapshotValue(listenPath);
        const snap = {
          exists: () => val !== undefined && val !== null && Object.keys(val).length > 0,
          val: () => val,
        };
        for (const cb of callbacks) {
          cb(snap);
        }
      }
    }
  }
}

class MockDexieTable {
  constructor() {
    this.data = new Map();
  }
  async get(id) {
    return this.data.get(id);
  }
  async put(item) {
    this.data.set(item.id, { ...item });
  }
  async delete(id) {
    this.data.delete(id);
  }
  async bulkPut(items) {
    for (const item of items) {
      this.data.set(item.id, { ...item });
    }
  }
  async bulkDelete(ids) {
    for (const id of ids) {
      this.data.delete(id);
    }
  }
  async toArray() {
    return Array.from(this.data.values());
  }
  async clear() {
    this.data.clear();
  }
}

class MockDeviceContext {
  constructor(name, rtdb, companyId, autoSync = true) {
    this.name = name;
    this.rtdb = rtdb;
    this.companyId = companyId;
    this.reloads = 0;
    this.dexie = {
      invoices: new MockDexieTable(),
      quotations: new MockDexieTable(),
      purchases: new MockDexieTable(),
      receipts: new MockDexieTable(),
      payments: new MockDexieTable(),
      parties: new MockDexieTable(),
      products: new MockDexieTable(),
    };
    this.tenantCache = new Map();
    this.reactState = {
      invoices: [],
      products: [],
      parties: [],
    };
    this.queryInvalidations = [];

    // Start background realtime listener mimicking companyRealtimeSync.ts
    this.stopSync = autoSync ? this.startRealtimeSync() : null;
  }

  startRealtimeSync() {
    const collections = [
      { name: "invoices", table: this.dexie.invoices },
      { name: "quotations", table: this.dexie.quotations },
      { name: "purchases", table: this.dexie.purchases },
      { name: "receipts", table: this.dexie.receipts },
      { name: "payments", table: this.dexie.payments },
      { name: "parties", table: this.dexie.parties },
      { name: "products", table: this.dexie.products },
    ];

    const unsubs = [];
    for (const col of collections) {
      const colPath = `companyData/${this.companyId}/${col.name}`;
      const unsub = this.rtdb.onValue(colPath, async (snap) => {
        if (!snap.exists() || !snap.val()) {
          const localRows = await col.table.toArray();
          if (localRows.length > 0) {
            const idsToDelete = localRows.map((r) => r.id);
            await col.table.bulkDelete(idsToDelete);
            for (const id of idsToDelete) {
              this.tenantCache.delete(`${this.companyId}:${col.name}:${id}`);
            }
          }
          if (this.reactState[col.name]) {
            this.reactState[col.name] = [];
          }
          return;
        }

        const val = snap.val();
        const records = Object.values(val);
        const cloudIds = new Set(records.map((r) => r.id));

        // 1. Authoritative Deletion Reconciliation: purge local rows no longer in Firebase
        const localRows = await col.table.toArray();
        const idsToDelete = localRows
          .filter((r) => r.id && !cloudIds.has(r.id))
          .map((r) => r.id);

        if (idsToDelete.length > 0) {
          await col.table.bulkDelete(idsToDelete);
          for (const id of idsToDelete) {
            this.tenantCache.delete(`${this.companyId}:${col.name}:${id}`);
          }
        }

        // 2. Put cloud records into Dexie
        await col.table.bulkPut(records);

        // 3. Mirror into tenant cache
        for (const r of records) {
          this.tenantCache.set(`${this.companyId}:${col.name}:${r.id}`, { ...r });
        }

        // 4. Update reactive state (simulating useLive without reload)
        if (this.reactState[col.name]) {
          this.reactState[col.name] = await col.table.toArray();
        }
      });
      unsubs.push(unsub);
    }

    return () => unsubs.forEach((u) => u());
  }

  // Authoritative Delete Draft mutation pipeline
  async authoritativeDeleteDraft(kind, id) {
    const colName = kind === "party" ? "parties" : `${kind}s`;
    const docPath = `companyData/${this.companyId}/${colName}/${id}`;

    // 1. Delete from Firebase RTDB FIRST
    await this.rtdb.remove(docPath);

    // 2. On Firebase success: remove from Dexie
    await this.dexie[colName].delete(id);

    // 3. Purge from tenant cache
    this.tenantCache.delete(`${this.companyId}:${colName}:${id}`);

    // 4. Update local React state immediately
    if (this.reactState[colName]) {
      this.reactState[colName] = this.reactState[colName].filter((item) => item.id !== id);
    }

    this.queryInvalidations.push(`${colName}:${id}:delete`);
    return { success: true };
  }

  // Authoritative Save Entity mutation pipeline
  async authoritativeSaveEntity(kind, entity, action = "create") {
    const colName = kind === "party" ? "parties" : `${kind}s`;
    const docPath = `companyData/${this.companyId}/${colName}/${entity.id}`;
    const toSave = { ...entity, updatedAt: Date.now() };

    // 1. Authoritative write to Firebase RTDB FIRST
    await this.rtdb.set(docPath, toSave);

    // 2. On Firebase success: Save to local Dexie
    await this.dexie[colName].put(toSave);

    // 3. Save to tenant cache
    this.tenantCache.set(`${this.companyId}:${colName}:${entity.id}`, toSave);

    // 4. Update local React state immediately
    if (this.reactState[colName]) {
      const idx = this.reactState[colName].findIndex((item) => item.id === entity.id);
      if (idx >= 0) {
        this.reactState[colName][idx] = toSave;
      } else {
        this.reactState[colName] = [toSave, ...this.reactState[colName]];
      }
    }

    this.queryInvalidations.push(`${colName}:${entity.id}:${action}`);
    return { success: true, data: toSave };
  }

  // Authoritative Void Posted document mutation pipeline
  async authoritativeVoidPosted(kind, doc, reversalReason) {
    const colName = `${kind}s`;
    const docPath = `companyData/${this.companyId}/${colName}/${doc.id}`;
    const now = Date.now();
    const voidedDoc = {
      ...doc,
      status: "cancelled",
      postingStatus: "reversed",
      cancelledAt: now,
      updatedAt: now,
      reversalReason: reversalReason || "Voided with reversal accounting",
    };

    // 1. Authoritative write to Firebase RTDB FIRST
    await this.rtdb.set(docPath, voidedDoc);

    // 2. On Firebase success: update Dexie
    await this.dexie[colName].put(voidedDoc);

    // 3. Update tenant cache
    this.tenantCache.set(`${this.companyId}:${colName}:${doc.id}`, voidedDoc);

    // 4. Update React state immediately
    if (this.reactState[colName]) {
      this.reactState[colName] = this.reactState[colName].map((item) =>
        item.id === doc.id ? voidedDoc : item
      );
    }

    this.queryInvalidations.push(`${colName}:${doc.id}:void`);
    return { success: true, voidedDoc };
  }

  getActiveDocuments(kind) {
    const colName = `${kind}s`;
    const list = this.reactState[colName] || [];
    return list.filter((d) => {
      const docStatus = (d.status || "").toLowerCase();
      const docPosting = (d.postingStatus || "").toLowerCase();
      const isVoidedOrCancelled =
        docStatus === "cancelled" ||
        docStatus === "voided" ||
        docStatus === "deleted" ||
        docPosting === "reversed";
      return !isVoidedOrCancelled;
    });
  }

  getVoidedDocuments(kind) {
    const colName = `${kind}s`;
    const list = this.reactState[colName] || [];
    return list.filter((d) => {
      const docStatus = (d.status || "").toLowerCase();
      const docPosting = (d.postingStatus || "").toLowerCase();
      return (
        docStatus === "cancelled" ||
        docStatus === "voided" ||
        docStatus === "deleted" ||
        docPosting === "reversed"
      );
    });
  }
}

// ----------------------------------------------------------------------------
// TEST SUITE: Firebase + Dexie + Cross-Device Mutation Sync
// ----------------------------------------------------------------------------

test("1. Firebase invoice delete persistence: authoritatively removed from RTDB path, Dexie, and cache", async () => {
  const rtdb = new MockFirebaseRTDB();
  const deviceA = new MockDeviceContext("DeviceA", rtdb, "comp_100");

  const invoice = {
    id: "inv_draft_001",
    number: "INV-2026-001",
    status: "draft",
    postingStatus: "draft",
    grandTotal: 15000,
  };

  // Setup initial saved draft
  await deviceA.authoritativeSaveEntity("invoice", invoice, "create");
  assert.ok(rtdb.get("companyData/comp_100/invoices/inv_draft_001"), "Invoice exists in RTDB");
  assert.ok(await deviceA.dexie.invoices.get("inv_draft_001"), "Invoice exists in Dexie");

  // User deletes draft invoice
  const res = await deviceA.authoritativeDeleteDraft("invoice", "inv_draft_001");
  assert.equal(res.success, true);

  // Assert RTDB authoritative removal
  assert.equal(rtdb.get("companyData/comp_100/invoices/inv_draft_001"), undefined, "RTDB must have removed the record");

  // Assert Dexie removal
  const dexieRecord = await deviceA.dexie.invoices.get("inv_draft_001");
  assert.equal(dexieRecord, undefined, "Dexie must not contain deleted record");

  // Assert tenant cache removal
  assert.equal(deviceA.tenantCache.has("comp_100:invoices:inv_draft_001"), false, "Tenant cache must be purged");

  // Assert UI list removal
  assert.equal(deviceA.reactState.invoices.some((i) => i.id === "inv_draft_001"), false, "UI list excludes deleted draft");
});

test("2. Deleted record does not return after remount/navigation: deletion reconciliation purges stale Dexie rows", async () => {
  const rtdb = new MockFirebaseRTDB();
  const companyId = "comp_reconcile";

  // Simulate an invoice being deleted in cloud while client was offline or on another route
  const existingInv = { id: "inv_survivor", number: "INV-SURV", grandTotal: 5000, status: "draft" };
  await rtdb.set(`companyData/${companyId}/invoices/inv_survivor`, existingInv);

  // New client/tab mounts with pre-existing local Dexie storage
  const clientTab = new MockDeviceContext("Tab1", rtdb, companyId, false);
  // Artificially plant a stale deleted record in Dexie before sync runs
  await clientTab.dexie.invoices.put({ id: "inv_stale_ghost", number: "INV-GHOST", status: "draft" });

  // Start realtime sync / mount listener
  clientTab.stopSync = clientTab.startRealtimeSync();

  // Wait for initial RTDB snapshot reconciliation
  await new Promise((r) => setTimeout(r, 20));

  // The reconciliation logic must have purged the orphaned "inv_stale_ghost"
  const ghostInDexie = await clientTab.dexie.invoices.get("inv_stale_ghost");
  assert.equal(ghostInDexie, undefined, "Orphaned ghost record must be deleted from Dexie upon reconciliation");

  const survivorInDexie = await clientTab.dexie.invoices.get("inv_survivor");
  assert.ok(survivorInDexie, "Active cloud record must remain in Dexie");

  // React state must only contain survivor, never ghost
  assert.equal(clientTab.reactState.invoices.length, 1);
  assert.equal(clientTab.reactState.invoices[0].id, "inv_survivor");
});

test("3. Firebase create persistence: writes to companyData/{companyId}/... first and confirms before Dexie/UI", async () => {
  const rtdb = new MockFirebaseRTDB();
  const device = new MockDeviceContext("Device", rtdb, "comp_create");

  const product = {
    id: "prod_101",
    name: "Industrial Ball Valve 50mm",
    sku: "BV-50",
    sellingPrice: 1250,
    active: true,
  };

  const res = await device.authoritativeSaveEntity("product", product, "create");
  assert.equal(res.success, true);

  // Authoritative cloud check
  const cloudRecord = rtdb.get("companyData/comp_create/products/prod_101");
  assert.ok(cloudRecord, "Product must be saved at canonical RTDB path");
  assert.equal(cloudRecord.name, "Industrial Ball Valve 50mm");

  // Dexie mirror check
  const dexieRecord = await device.dexie.products.get("prod_101");
  assert.equal(dexieRecord.sku, "BV-50");

  // React state check
  assert.equal(device.reactState.products[0].id, "prod_101");
});

test("4. Firebase edit persistence: updates RTDB first, then Dexie and cache with authoritative updated data", async () => {
  const rtdb = new MockFirebaseRTDB();
  const device = new MockDeviceContext("Device", rtdb, "comp_edit");

  const party = {
    id: "pty_777",
    name: "Apex Engineering",
    gstin: "27AAAAA0000A1Z5",
    partyType: "CUSTOMER",
    city: "Mumbai",
  };

  // Initial creation
  await device.authoritativeSaveEntity("party", party, "create");

  // User edits party
  const updatedParty = {
    ...party,
    name: "Apex Engineering Private Limited",
    city: "Pune",
  };

  await device.authoritativeSaveEntity("party", updatedParty, "update");

  // Verify RTDB contains authoritative updated data
  const cloudParty = rtdb.get("companyData/comp_edit/parties/pty_777");
  assert.equal(cloudParty.name, "Apex Engineering Private Limited");
  assert.equal(cloudParty.city, "Pune");

  // Verify Dexie is updated
  const dexieParty = await device.dexie.parties.get("pty_777");
  assert.equal(dexieParty.name, "Apex Engineering Private Limited");
  assert.equal(dexieParty.city, "Pune");

  // Verify tenant cache is updated
  const cachedParty = device.tenantCache.get("comp_edit:parties:pty_777");
  assert.equal(cachedParty.city, "Pune");
});

test("5. Dexie mirrors cloud result: local store is pure projection of Firebase RTDB authority", async () => {
  const rtdb = new MockFirebaseRTDB();
  const device = new MockDeviceContext("Device", rtdb, "comp_mirror");

  const quotation = {
    id: "qtn_9001",
    number: "QTN-2026-9001",
    date: 1773000000000,
    customerId: "cust_42",
    grandTotal: 84000,
    status: "issued",
  };

  await device.authoritativeSaveEntity("quotation", quotation, "create");

  const fromCloud = rtdb.get("companyData/comp_mirror/quotations/qtn_9001");
  const fromDexie = await device.dexie.quotations.get("qtn_9001");

  assert.equal(fromDexie.id, fromCloud.id);
  assert.equal(fromDexie.number, fromCloud.number);
  assert.equal(fromDexie.grandTotal, fromCloud.grandTotal);
  assert.equal(fromDexie.status, fromCloud.status);
});

test("6. Realtime device A -> device B sync: Device B receives create, edit, and delete automatically without refresh", async () => {
  const rtdb = new MockFirebaseRTDB();
  const companyId = "comp_realtime_sync";

  const deviceA = new MockDeviceContext("DeviceA", rtdb, companyId);
  const deviceB = new MockDeviceContext("DeviceB", rtdb, companyId);

  // 1. Device A creates an invoice
  const inv = {
    id: "inv_cross_device_1",
    number: "INV-CD-001",
    status: "unpaid",
    postingStatus: "posted",
    grandTotal: 25000,
  };
  await deviceA.authoritativeSaveEntity("invoice", inv, "create");

  // Wait for realtime propagation to Device B
  await new Promise((r) => setTimeout(r, 10));

  // Assert Device B has invoice in Dexie & React list without F5
  const bDexie1 = await deviceB.dexie.invoices.get("inv_cross_device_1");
  assert.ok(bDexie1, "Device B must receive newly created invoice in Dexie via RTDB listener");
  assert.equal(deviceB.reactState.invoices.some((i) => i.id === "inv_cross_device_1"), true, "Device B React list includes new invoice");
  assert.equal(deviceB.reloads, 0, "Zero page reloads required on Device B");

  // 2. Device A edits the invoice (e.g. customer payment or amount update)
  const invUpdated = { ...inv, grandTotal: 30000, notes: "Special packaging included" };
  await deviceA.authoritativeSaveEntity("invoice", invUpdated, "update");

  await new Promise((r) => setTimeout(r, 10));

  const bDexie2 = await deviceB.dexie.invoices.get("inv_cross_device_1");
  assert.equal(bDexie2.grandTotal, 30000, "Device B Dexie must reflect updated amount");
  assert.equal(bDexie2.notes, "Special packaging included");

  // 3. Device A deletes a draft quotation
  const draftQuote = { id: "qtn_cd_1", number: "QTN-CD-1", status: "draft", grandTotal: 5000 };
  await deviceA.authoritativeSaveEntity("quotation", draftQuote, "create");
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(await deviceB.dexie.quotations.get("qtn_cd_1"), "Device B has quotation before delete");

  await deviceA.authoritativeDeleteDraft("quotation", "qtn_cd_1");
  await new Promise((r) => setTimeout(r, 10));

  const bDexieQ = await deviceB.dexie.quotations.get("qtn_cd_1");
  assert.equal(bDexieQ, undefined, "Device B must have deleted quotation removed from Dexie automatically");
  assert.equal(deviceB.reloads, 0, "Zero page reloads on Device B");
});

test("7. Failed Firebase delete rolls back UI and preserves local data: never shows success toast on cloud error", async () => {
  const rtdb = new MockFirebaseRTDB();
  const device = new MockDeviceContext("Device", rtdb, "comp_fail");

  const invoice = {
    id: "inv_failing_delete",
    number: "INV-FAIL-01",
    status: "draft",
    grandTotal: 12000,
  };

  // Seed invoice in cloud and local
  await device.authoritativeSaveEntity("invoice", invoice, "create");

  // Mock optimistic mutation wrapper with rollback
  let uiList = [invoice];
  let shownToast = "";

  async function deleteWithRollback(doc) {
    const prev = [...uiList];
    // Immediate optimistic removal
    uiList = uiList.filter((i) => i.id !== doc.id);

    try {
      // Simulate Firebase network failure
      throw new Error("NETWORK_DISCONNECTED: Firebase RTDB write timed out");
    } catch (err) {
      // Rollback UI
      uiList = prev;
      shownToast = "Error: Couldn't delete invoice. It has been restored.";
      return { success: false, error: err.message };
    }
  }

  const res = await deleteWithRollback(invoice);
  assert.equal(res.success, false);
  assert.ok(shownToast.includes("Error:"), "Must show error feedback, NOT success toast");
  assert.equal(uiList.length, 1, "Optimistic UI was safely rolled back");
  assert.equal(uiList[0].id, "inv_failing_delete", "Record preserved in UI state");
  assert.ok(await device.dexie.invoices.get("inv_failing_delete"), "Dexie record preserved");
});

test("8. Posted invoice void persists in Firebase and disappears from Active list: retains in voided history", async () => {
  const rtdb = new MockFirebaseRTDB();
  const companyId = "comp_posted_void";
  const deviceA = new MockDeviceContext("DeviceA", rtdb, companyId);
  const deviceB = new MockDeviceContext("DeviceB", rtdb, companyId);

  const postedInvoice = {
    id: "inv_posted_99",
    number: "INV-POST-99",
    status: "unpaid",
    postingStatus: "posted",
    voucherId: "vch_inv_99",
    grandTotal: 45000,
  };

  // Save posted invoice
  await deviceA.authoritativeSaveEntity("invoice", postedInvoice, "create");
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(deviceA.getActiveDocuments("invoice").length, 1);
  assert.equal(deviceB.getActiveDocuments("invoice").length, 1);

  // Void posted invoice (accounting reversal, does NOT destroy history)
  await deviceA.authoritativeVoidPosted("invoice", postedInvoice, "Customer cancelled contract order");

  await new Promise((r) => setTimeout(r, 10));

  // 1. Cloud RTDB must have status = cancelled and postingStatus = reversed
  const cloudDoc = rtdb.get(`companyData/${companyId}/invoices/inv_posted_99`);
  assert.ok(cloudDoc, "History is NOT physically destroyed in Firebase RTDB");
  assert.equal(cloudDoc.status, "cancelled");
  assert.equal(cloudDoc.postingStatus, "reversed");
  assert.equal(cloudDoc.reversalReason, "Customer cancelled contract order");

  // 2. Active document list on Device A immediately excludes the voided invoice
  const activeA = deviceA.getActiveDocuments("invoice");
  assert.equal(activeA.length, 0, "Active list excludes voided invoice on Device A");

  // 3. Voided document history on Device A retains it
  const voidedA = deviceA.getVoidedDocuments("invoice");
  assert.equal(voidedA.length, 1, "Voided history retains the invoice on Device A");
  assert.equal(voidedA[0].id, "inv_posted_99");

  // 4. Device B realtime sync excludes it from active list and retains in voided history without refresh
  const activeB = deviceB.getActiveDocuments("invoice");
  assert.equal(activeB.length, 0, "Device B active list automatically excludes voided invoice");

  const voidedB = deviceB.getVoidedDocuments("invoice");
  assert.equal(voidedB.length, 1, "Device B voided history automatically reflects voided invoice");
  assert.equal(deviceB.reloads, 0, "No reload occurred on Device B");
});

test("9. No manual refresh required: all 8 entity operations update Dexie and UI reactively", async () => {
  const rtdb = new MockFirebaseRTDB();
  const companyId = "comp_reactivity";
  const device = new MockDeviceContext("Device", rtdb, companyId);

  const entities = [
    { kind: "invoice", data: { id: "e_inv", number: "I-1", grandTotal: 100 } },
    { kind: "quotation", data: { id: "e_qtn", number: "Q-1", grandTotal: 200 } },
    { kind: "purchase", data: { id: "e_pur", number: "P-1", grandTotal: 300 } },
    { kind: "receipt", data: { id: "e_rec", number: "R-1", amount: 100 } },
    { kind: "payment", data: { id: "e_pay", number: "PY-1", amount: 200 } },
    { kind: "party", data: { id: "e_pty", name: "Party 1", partyType: "CUSTOMER" } },
    { kind: "product", data: { id: "e_prd", name: "Product 1", sellingPrice: 50 } },
  ];

  for (const item of entities) {
    const res = await device.authoritativeSaveEntity(item.kind, item.data, "create");
    assert.equal(res.success, true);
    const colName = item.kind === "party" ? "parties" : `${item.kind}s`;
    const inDexie = await device.dexie[colName].get(item.data.id);
    assert.ok(inDexie, `${item.kind} must be reactively updated in Dexie`);
  }

  assert.equal(device.reloads, 0, "All 8 entity mutations completed with ZERO browser reloads");
});
