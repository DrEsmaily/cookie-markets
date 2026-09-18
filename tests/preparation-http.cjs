const assert = require("node:assert/strict");
const { test } = require("node:test");

const url = `${process.env.TEST_APP_URL ?? "http://127.0.0.1:3001"}/api/positions/prepare`;
const base = { market: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx", user: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx", amount: "1", action: "split" };

test("HTTP ask discovery rejects invalid market addresses before accessing RPC", async () => {
  const response = await fetch(`${process.env.TEST_APP_URL ?? "http://127.0.0.1:3001"}/api/protocol?asks=not-a-public-key`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
});

for (const [name, body, status] of [
  ["malformed JSON", "{", 400],
  ["missing fields", "{}", 400],
  ["unsupported action", JSON.stringify({ ...base, action: "buy" }), 400],
  ["missing redemption side", JSON.stringify({ ...base, action: "redeem" }), 400],
  ["invalid wrapping flag", JSON.stringify({ ...base, wrapNative: "true" }), 400],
  ["invalid public key", JSON.stringify({ ...base, market: "not-a-public-key" }), 400],
  ["oversized body", JSON.stringify({ value: "x".repeat(9000) }), 413],
]) {
  test(`HTTP preparation refuses ${name} without a transaction`, async () => {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.ok(result.error);
    assert.equal(result.unsignedTransaction, undefined);
  });
}
