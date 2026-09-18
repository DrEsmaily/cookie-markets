const assert = require("node:assert/strict");
const { test } = require("node:test");

const url = `${process.env.TEST_APP_URL ?? "http://127.0.0.1:3001"}/api/positions/prepare`;
const base = { market: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx", user: "US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx", amount: "1", action: "split" };

test("HTTP ask discovery rejects invalid market addresses before accessing RPC", async () => {
  const response = await fetch(`${process.env.TEST_APP_URL ?? "http://127.0.0.1:3001"}/api/protocol?asks=not-a-public-key`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error);
});

const orderBase = { market: base.market, user: base.user, action: "fill", order: base.market, amount: "1", maximumDebit: "1", question: "Test?", resolutionSource: "Test", resolutionRules: "Test rules" };
for (const [name, body, status] of [
  ["malformed JSON", "{", 400],
  ["missing fields", "{}", 400],
  ["unsupported action", JSON.stringify({ ...orderBase, action: "buy" }), 400],
  ["missing shares", JSON.stringify({ ...orderBase, amount: undefined }), 400],
  ["missing debit limit", JSON.stringify({ ...orderBase, maximumDebit: undefined }), 400],
  ["missing order", JSON.stringify({ ...orderBase, order: undefined }), 400],
  ["invalid wrapping flag", JSON.stringify({ ...orderBase, wrapNative: "true" }), 400],
  ["wrapping cancellation", JSON.stringify({ ...orderBase, action: "cancel", wrapNative: true }), 400],
  ["invalid public key", JSON.stringify({ ...orderBase, market: "invalid" }), 400],
  ["missing terms", JSON.stringify({ ...orderBase, question: undefined }), 400],
  ["invalid placement nonce", JSON.stringify({ ...orderBase, action: "place", nonce: "-1", side: "yes", price: "0.5", expiresAt: "2000000000" }), 400],
  ["invalid placement side", JSON.stringify({ ...orderBase, action: "place", nonce: "1", side: "other", price: "0.5", expiresAt: "2000000000" }), 400],
  ["oversized body", JSON.stringify({ value: "x".repeat(9000) }), 413],
]) {
  test(`HTTP trading preparation refuses ${name} without a transaction`, async () => {
    const response = await fetch(`${process.env.TEST_APP_URL ?? "http://127.0.0.1:3001"}/api/orders/prepare`, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, status);
    const result = await response.json();
    assert.ok(result.error);
    assert.equal(result.unsignedTransaction, undefined);
  });
}

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
