import test from "node:test";
import assert from "node:assert/strict";
import { readApiResponse, spreadsheetRequest, ApiResponseError, safeApiError } from "../lib/api-response.ts";
import { fetchSpreadsheet } from "../lib/spreadsheet.ts";

test("XML, HTML, malformed JSON and empty responses never leak parser errors", async () => {
  for (const [content, type, status] of [["<?xml version=\"1.0\"?><Error>Unavailable</Error>", "application/xml", 503],
    ["<!doctype html><html>Login</html>", "text/html", 200], ["<Error/>", "application/json", 502],
    ["{", "application/json", 200], ["", "application/json", 200], ["null", "application/json", 200]]) {
    await assert.rejects(readApiResponse(new Response(content, { status, headers: { "content-type": type } })), error => {
      assert.ok(error instanceof ApiResponseError);
      assert.doesNotMatch(error.message, /unexpected|not valid JSON|<Error|<html/i);
      return true;
    });
  }
  assert.equal((await readApiResponse(Response.json({ inserted: 3 }))).inserted, 3);
  assert.doesNotMatch(safeApiError("Unexpected token '<', \"<?xml vers\" is not valid JSON"), /Unexpected|<\?xml/);
});

test("a transient XML response is retried with the same sync request identity", async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, options) => {
    bodies.push(options.body);
    return bodies.length === 1 ? new Response("<?xml version=\"1.0\"?><Error/>", { status: 503, headers: { "content-type": "application/xml" } })
      : Response.json({ done: true, inserted: 2 });
  };
  try {
    const result = await spreadsheetRequest({ action: "sync", requestId: "same-run" });
    assert.equal(result.inserted, 2);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
  } finally { globalThis.fetch = originalFetch; }
});

test("permissions and validation errors are not retried", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ error: "No autorizado" }, { status: 403 }); };
  try { await assert.rejects(spreadsheetRequest({ action: "sync" }), error => error.status === 403); assert.equal(calls, 1); }
  finally { globalThis.fetch = originalFetch; }
});

test("source configuration and imports without request identity are not automatically replayed", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response("<?xml version=\"1.0\"?><Error/>", { status: 503 }); };
  try {
    for (const payload of [{ action: "save_source" }, { action: "sync" }]) {
      calls = 0;
      await assert.rejects(spreadsheetRequest(payload));
      assert.equal(calls, 1);
    }
  } finally { globalThis.fetch = originalFetch; }
});

test("Google error documents are rejected rather than treated as CSV rows", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<?xml version=\"1.0\"?><Error>Unavailable</Error>", { headers: { "content-type": "application/xml" } });
  try { await assert.rejects(fetchSpreadsheet("https://docs.google.com/spreadsheets/d/test/edit?sheet=Set"), /página de error/); }
  finally { globalThis.fetch = originalFetch; }
});
