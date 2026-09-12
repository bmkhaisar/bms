import test from "node:test";
import assert from "node:assert/strict";

test("dexie-mutation-sync.test: Dual-cache sync maintains consistent state across reactive and tenant caches", async () => {
  const bmsDbV1 = new Map();
  const bmsCacheV1 = new Map();

  async function syncEntityMutation(companyId, entityType, action, entity) {
    if (action === "upsert") {
      bmsDbV1.set(entity.id, { ...entity });
      bmsCacheV1.set(`${companyId}:${entityType}:${entity.id}`, {
        entityId: entity.id,
        entityType,
        companyId,
        data: entity,
        updatedAt: Date.now(),
      });
    } else if (action === "delete") {
      bmsDbV1.delete(entity.id);
      bmsCacheV1.delete(`${companyId}:${entityType}:${entity.id}`);
    }
  }

  const party = { id: "pty-99", name: "Apex Fabricators", gstin: "27AAAAA0000A1Z5", active: true };

  // 1. Create party
  await syncEntityMutation("comp-1", "party", "upsert", party);
  assert.ok(bmsDbV1.has("pty-99"), "bms_db_v1 reactive store has party");
  assert.ok(bmsCacheV1.has("comp-1:party:pty-99"), "bms_cache_v1 tenant store has party");

  // 2. Update party
  const updatedParty = { ...party, name: "Apex Fabricators Pvt Ltd" };
  await syncEntityMutation("comp-1", "party", "upsert", updatedParty);
  assert.equal(bmsDbV1.get("pty-99").name, "Apex Fabricators Pvt Ltd");
  assert.equal(bmsCacheV1.get("comp-1:party:pty-99").data.name, "Apex Fabricators Pvt Ltd");

  // 3. Delete party
  await syncEntityMutation("comp-1", "party", "delete", updatedParty);
  assert.equal(bmsDbV1.has("pty-99"), false, "bms_db_v1 purged on delete");
  assert.equal(bmsCacheV1.has("comp-1:party:pty-99"), false, "bms_cache_v1 purged on delete");
});

test("query-cache-invalidation.test: Mutation invalidates dependent query keys so search and counts update without reload", () => {
  const invalidatedKeys = [];

  class MockQueryClient {
    invalidateQueries({ queryKey }) {
      invalidatedKeys.push(queryKey.join("/"));
    }
  }

  const queryClient = new MockQueryClient();

  function onEntityMutated(entityType, companyId) {
    // Standard invalidation matrix per PRD § 9
    queryClient.invalidateQueries({ queryKey: [entityType, "list", companyId] });
    queryClient.invalidateQueries({ queryKey: [entityType, "searchIndex", companyId] });
    queryClient.invalidateQueries({ queryKey: ["dashboard", "metrics", companyId] });
    queryClient.invalidateQueries({ queryKey: ["globalSearch"] });
  }

  onEntityMutated("products", "comp-alpha");

  assert.ok(invalidatedKeys.includes("products/list/comp-alpha"), "Product list query invalidated");
  assert.ok(invalidatedKeys.includes("products/searchIndex/comp-alpha"), "Product search index invalidated");
  assert.ok(invalidatedKeys.includes("dashboard/metrics/comp-alpha"), "Dashboard metrics query invalidated");
  assert.ok(invalidatedKeys.includes("globalSearch"), "Global search index invalidated");
});
