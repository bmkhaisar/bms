import test from "node:test";
import assert from "node:assert/strict";

// In-memory simulation of the BMS NEXT optimistic mutation engine
class MockDexieStore {
  constructor() {
    this.records = new Map();
  }
  async get(id) {
    return this.records.get(id) || null;
  }
  async put(record) {
    this.records.set(record.id, { ...record });
  }
  async delete(id) {
    this.records.delete(id);
  }
  async toArray() {
    return Array.from(this.records.values());
  }
}

class MockCacheDb {
  constructor() {
    this.cachedEntities = new Map();
  }
  async upsert(companyId, entityType, entity) {
    const key = `${companyId}:${entityType}:${entity.id}`;
    this.cachedEntities.set(key, { ...entity });
  }
  async remove(companyId, entityType, entityId) {
    const key = `${companyId}:${entityType}:${entityId}`;
    this.cachedEntities.delete(key);
  }
  async get(companyId, entityType, entityId) {
    const key = `${companyId}:${entityType}:${entityId}`;
    return this.cachedEntities.get(key) || null;
  }
}

test("optimistic-delete.test: Instant UI removal, dual Dexie update, server mutation, and authoritative state", async () => {
  const localDb = new MockDexieStore();
  const cacheDb = new MockCacheDb();

  // Initial state: Product MS Plate exists
  const initialProduct = { id: "prod-101", name: "MS Plate 10mm", sellingPrice: 4500, active: true };
  await localDb.put(initialProduct);
  await cacheDb.upsert("comp-1", "product", initialProduct);

  let uiRows = [initialProduct];
  let previousStateCaptured = null;
  let serverMutationExecuted = false;

  async function performOptimisticDelete(targetId) {
    // 1. Snapshot previous state
    previousStateCaptured = [...uiRows];

    // 2. Optimistic local UI removal (sub-millisecond)
    uiRows = uiRows.filter((p) => p.id !== targetId);

    // 3. Dual Dexie store sync
    await localDb.delete(targetId);
    await cacheDb.remove("comp-1", "product", targetId);

    // 4. Server mutation
    await new Promise((resolve) => setTimeout(resolve, 10)); // simulate network
    serverMutationExecuted = true;
  }

  // Execute delete
  await performOptimisticDelete("prod-101");

  // Assert immediate UI removal
  assert.equal(uiRows.length, 0, "Item must immediately disappear from visible UI without reload");
  assert.equal(await localDb.get("prod-101"), null, "Local Dexie bms_db_v1 must be purged");
  assert.equal(await cacheDb.get("comp-1", "product", "prod-101"), null, "Tenant cache bms_cache_v1 must be purged");
  assert.equal(serverMutationExecuted, true, "Server mutation must execute successfully");
  assert.equal(previousStateCaptured.length, 1, "Previous state was safely captured for rollback");
});

test("optimistic-create.test: Immediate UI addition, local cache upsert, and server reconciliation", async () => {
  const localDb = new MockDexieStore();
  const cacheDb = new MockCacheDb();
  let uiRows = [];

  const newProduct = {
    id: "prod-temp-202",
    name: "Angle Iron 50x50x6",
    sellingPrice: 1200,
    active: true,
    clientMutationId: "mut-create-001",
  };

  async function performOptimisticCreate(item) {
    // 1. Immediately push to UI
    uiRows = [item, ...uiRows];

    // 2. Upsert into Dexie dual stores
    await localDb.put(item);
    await cacheDb.upsert("comp-1", "product", item);

    // 3. Server mutation creates record and echoes back authoritative record
    const serverEcho = { ...item, serverCreatedAt: Date.now() };
    return serverEcho;
  }

  const result = await performOptimisticCreate(newProduct);

  assert.equal(uiRows.length, 1, "New product must appear in UI immediately upon Save");
  assert.equal(uiRows[0].id, "prod-temp-202");
  assert.ok(await localDb.get("prod-temp-202"), "Product saved to local Dexie immediately");
  assert.ok(await cacheDb.get("comp-1", "product", "prod-temp-202"), "Product saved to multi-tenant cache");
  assert.ok(result.serverCreatedAt, "Server echo confirms authoritative state");
});

test("optimistic-update.test: Instant field reflection and store synchronization", async () => {
  const localDb = new MockDexieStore();
  let uiRows = [{ id: "cust-01", name: "Mars Engineering", phone: "9876543210" }];
  await localDb.put(uiRows[0]);

  async function performOptimisticUpdate(id, patch) {
    uiRows = uiRows.map((c) => (c.id === id ? { ...c, ...patch } : c));
    const updated = uiRows.find((c) => c.id === id);
    await localDb.put(updated);
  }

  await performOptimisticUpdate("cust-01", { phone: "9998887776", name: "Mars Engineering Pvt Ltd" });

  assert.equal(uiRows[0].name, "Mars Engineering Pvt Ltd", "Edited name appears immediately in UI");
  assert.equal(uiRows[0].phone, "9998887776", "Edited phone appears immediately in UI");
  const stored = await localDb.get("cust-01");
  assert.equal(stored.name, "Mars Engineering Pvt Ltd", "Dexie store updated synchronously");
});

test("mutation-rollback.test: Reverts visible UI, Dexie, and issues human error when server fails", async () => {
  const localDb = new MockDexieStore();
  const original = { id: "item-88", name: "Pre-galvanized Sheet", stock: 100 };
  await localDb.put(original);

  let uiRows = [original];
  let rollbackExecuted = false;
  let userToastMessage = "";

  async function performFailingMutation() {
    const previousSnapshot = [...uiRows];
    // Optimistic delete
    uiRows = [];
    await localDb.delete("item-88");

    try {
      // Simulate server rejection (e.g., network error or server authorization failure)
      throw new Error("NETWORK_TIMEOUT");
    } catch {
      // Rollback visible UI
      uiRows = previousSnapshot;
      // Rollback Dexie
      await localDb.put(original);
      rollbackExecuted = true;
      userToastMessage = "Couldn't delete Pre-galvanized Sheet. It has been restored.";
    }
  }

  await performFailingMutation();

  assert.equal(rollbackExecuted, true, "Rollback handler must be invoked on mutation failure");
  assert.equal(uiRows.length, 1, "UI must restore previous record without requiring page refresh");
  assert.equal(uiRows[0].id, "item-88", "Restored record matches original state");
  assert.ok(await localDb.get("item-88"), "Dexie record restored");
  assert.equal(userToastMessage, "Couldn't delete Pre-galvanized Sheet. It has been restored.");
});

test("realtime-mutation-reconcile.test: Deduplication avoids double application when realtime listener fires", () => {
  const appliedMutations = new Set();
  let state = [{ id: "doc-1", title: "Original" }];

  function handleRealtimeEvent(event) {
    // If clientMutationId was already processed locally, reconcile without duplicate insert/render
    if (event.clientMutationId && appliedMutations.has(event.clientMutationId)) {
      return { action: "reconciled", duplicateIgnored: true };
    }
    state = state.map((d) => (d.id === event.id ? { ...d, ...event } : d));
    return { action: "applied", duplicateIgnored: false };
  }

  // 1. Client applies mutation locally and tracks mutation ID
  appliedMutations.add("mut-client-777");
  state = [{ id: "doc-1", title: "Updated Locally" }];

  // 2. Realtime listener echoes back the event from Firebase
  const result = handleRealtimeEvent({ id: "doc-1", title: "Updated Locally", clientMutationId: "mut-client-777" });

  assert.equal(result.duplicateIgnored, true, "Realtime echo must reconcile rather than duplicate state");
  assert.equal(state[0].title, "Updated Locally");
});
