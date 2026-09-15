import test from "node:test";
import assert from "node:assert/strict";
import { handleDeepLinkTransition } from "../src/lib/useDocumentDeepLink.ts";

const docA = { id: "doc_A", number: "Q-001" };
const docB = { id: "doc_B", number: "Q-002" };
const docC = { id: "doc_C", number: "Q-003" };
const docs = [docA, docB, docC];

test("Deep-link lifecycle: requestedId === null must NEVER close a manually opened editor", () => {
  // 1. User manually edits docA
  let state = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "manually_opened",
    activeDocId: "doc_A",
  };

  // 2. Documents update (e.g. customer selection / live Dexie update)
  const res = handleDeepLinkTransition(state, {
    type: "DOCUMENTS_UPDATED",
    documents: docs,
  });

  assert.equal(res.effect, undefined, "DOCUMENTS_UPDATED must not trigger close on manually opened editor");
  assert.equal(res.nextState.activeMode, "manually_opened");
  assert.equal(res.nextState.activeDocId, "doc_A");

  // 3. URL changed event with null urlId
  const urlRes = handleDeepLinkTransition(state, {
    type: "URL_CHANGED",
    urlId: null,
    documents: docs,
  });

  assert.equal(urlRes.effect, undefined, "requestedId === null must NEVER close a manually opened editor");
  assert.equal(urlRes.nextState.activeMode, "manually_opened");
});

test("Deep-link lifecycle: New Quotation with no ?id remains open through document updates", () => {
  // 1. User clicks New Quotation
  let state = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "new_document",
    activeDocId: null,
  };

  // 2. Documents update (e.g. party master / settings / Dexie sync)
  const res = handleDeepLinkTransition(state, {
    type: "DOCUMENTS_UPDATED",
    documents: docs,
  });

  assert.equal(res.effect, undefined, "DOCUMENTS_UPDATED must not close a new document editor");
  assert.equal(res.nextState.activeMode, "new_document");

  // 3. URL changed with null id
  const urlRes = handleDeepLinkTransition(state, {
    type: "URL_CHANGED",
    urlId: null,
    documents: docs,
  });

  assert.equal(urlRes.effect, undefined, "null urlId must not close a new document editor");
});

test("Deep-link lifecycle: browser Back from ?id=A closes ONLY the document opened from that URL", () => {
  // 1. Initial URL deep link ?id=doc_A
  let state = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "idle",
  };

  const openRes = handleDeepLinkTransition(state, {
    type: "URL_CHANGED",
    urlId: "doc_A",
    documents: docs,
  });

  assert.deepEqual(openRes.effect, { type: "OPEN", document: docA });
  assert.equal(openRes.nextState.activeMode, "url_opened");
  assert.equal(openRes.nextState.activeUrlDocumentId, "doc_A");

  // 2. Browser Back removes ?id
  const backRes = handleDeepLinkTransition(openRes.nextState, {
    type: "URL_CHANGED",
    urlId: null,
    documents: docs,
  });

  assert.deepEqual(backRes.effect, { type: "CLOSE" });
  assert.equal(backRes.nextState.activeMode, "idle");
  assert.equal(backRes.nextState.activeUrlDocumentId, null);
});

test("Deep-link lifecycle: browser Forward opens the requested document", () => {
  let state = {
    urlId: null,
    activeUrlDocumentId: null,
    activeMode: "idle",
  };

  const forwardRes = handleDeepLinkTransition(state, {
    type: "URL_CHANGED",
    urlId: "doc_B",
    documents: docs,
  });

  assert.deepEqual(forwardRes.effect, { type: "OPEN", document: docB });
  assert.equal(forwardRes.nextState.activeMode, "url_opened");
  assert.equal(forwardRes.nextState.activeUrlDocumentId, "doc_B");
});

test("Deep-link lifecycle: changing ?id=A → ?id=B switches to document B", () => {
  let state = {
    urlId: "doc_A",
    activeUrlDocumentId: "doc_A",
    activeMode: "url_opened",
    activeDocId: "doc_A",
  };

  const changeRes = handleDeepLinkTransition(state, {
    type: "URL_CHANGED",
    urlId: "doc_B",
    documents: docs,
  });

  assert.deepEqual(changeRes.effect, { type: "OPEN", document: docB });
  assert.equal(changeRes.nextState.activeUrlDocumentId, "doc_B");
  assert.equal(changeRes.nextState.activeMode, "url_opened");
});
