const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Keypair, SystemProgram } = require("@solana/web3.js");
const { buildAskTransactionInstructions } = require("../.test-build/ask-transactions.js");
const { deriveMarketAddresses, deriveAskAddresses, TOKEN_PROGRAM_ID } = require("../.test-build/cookie-markets-program.js");
const { deriveAssociatedTokenAddress, ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT } = require("../.test-build/token-instructions.js");
const { readPreparationBody, RequestSizeError } = require("../.test-build/preparation-body.js");
const maker = Keypair.fromSeed(Buffer.alloc(32, 11)).publicKey;
const taker = Keypair.fromSeed(Buffer.alloc(32, 12)).publicKey;
const addresses = deriveMarketAddresses(maker, 5n);
const ask = deriveAskAddresses(addresses.market, maker, 1n);
const market = { address: addresses.market.toBase58(), creator: maker.toBase58(), nonce: "5", yesMint: addresses.yesMint.toBase58(), noMint: addresses.noMint.toBase58(), collateralMint: NATIVE_MINT.toBase58(), closesAt: "2000000000", status: "open" };
const order = { address: ask.order.toBase58(), market: market.address, maker: maker.toBase58(), nonce: "1", shareMint: market.yesMint, feeRecipient: ask.order.toBase58(), totalShares: "80", filledShares: "0", remainingShares: "80", price: "500000", feeBps: 30, cancelled: false };

test("ask transaction assembly uses taker-paid recipient ATAs and exact quoted wrapping", async () => {
  const prepared = await buildAskTransactionInstructions(market, taker, { action: "fill", order, shares: 30n, maximumDebit: 16n, wrapNative: true });
  assert.equal(prepared.quote.buyerDebit, 16n);
  assert.equal(prepared.instructions.length, 7);
  for (const instruction of prepared.instructions.slice(0, 4)) {
    assert.ok(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.ok(instruction.keys[0].pubkey.equals(taker));
    assert.equal(instruction.keys[0].isSigner, true);
    assert.equal(instruction.keys[2].isSigner, false);
  }
  assert.ok(prepared.instructions[2].keys[2].pubkey.equals(maker));
  assert.ok(prepared.instructions[3].keys[1].pubkey.equals(deriveAssociatedTokenAddress(NATIVE_MINT, ask.order, true)));
  assert.ok(prepared.instructions[4].programId.equals(SystemProgram.programId));
  assert.equal(prepared.instructions[4].data.readBigUInt64LE(4), 16n);
  assert.ok(prepared.instructions[5].programId.equals(TOKEN_PROGRAM_ID));
  assert.equal(prepared.instructions[6].data.readBigUInt64LE(16), 16n);
  const noWrap = await buildAskTransactionInstructions(market, taker, { action: "fill", order, shares: 30n, maximumDebit: 20n });
  assert.equal(noWrap.instructions.length, 5);
  assert.equal(noWrap.instructions[4].data.readBigUInt64LE(16), 20n);
});

test("ask assembly preserves maker cancellation after market close and rejects unsafe requests", async () => {
  const prepared = await buildAskTransactionInstructions({ ...market, status: "resolved" }, maker, { action: "cancel", order });
  assert.equal(prepared.instructions.length, 2);
  const place = await buildAskTransactionInstructions(market, maker, { action: "place", nonce: 1n, side: "yes", shares: 80n, price: 500000n, expiresAt: 1900000000n });
  assert.equal(place.order, order.address);
  assert.equal(place.instructions.length, 1);
  for (const operation of [
    { action: "cancel", order },
    { action: "fill", order, shares: 81n, maximumDebit: 100n },
    { action: "fill", order, shares: 30n, maximumDebit: 15n },
    { action: "fill", order: { ...order, cancelled: true }, shares: 1n, maximumDebit: 1n },
    { action: "fill", order: { ...order, market: taker.toBase58() }, shares: 1n, maximumDebit: 1n },
    { action: "fill", order: { ...order, address: taker.toBase58() }, shares: 1n, maximumDebit: 1n },
  ]) await assert.rejects(buildAskTransactionInstructions(market, taker, operation));
  await assert.rejects(buildAskTransactionInstructions(market, maker, { action: "fill", order, shares: 30n, maximumDebit: 16n }));
  await assert.rejects(buildAskTransactionInstructions({ ...market, collateralMint: maker.toBase58() }, taker, { action: "fill", order, shares: 30n, maximumDebit: 16n, wrapNative: true }));
  await assert.rejects(buildAskTransactionInstructions(market, ask.order, { action: "cancel", order }));
});

test("bid assembly funds the full budget and preserves seller minimum proceeds", async () => {
  const { buildBidTransactionInstructions } = require("../.test-build/ask-transactions.js");
  const { deriveBidAddresses } = require("../.test-build/cookie-markets-program.js");
  const bid = deriveBidAddresses(addresses.market, maker, 1n);
  const bidOrder = { ...order, address: bid.order.toBase58(), collateralMint: market.collateralMint };
  const operation = { action: "place", nonce: 1n, side: "yes", shares: 80n, price: 500000n, expiresAt: 1900000000n, feeBps: 30, wrapNative: true };
  const placed = await buildBidTransactionInstructions(market, maker, operation);
  assert.equal(placed.quote.buyerDebit, 41n);
  assert.equal(placed.instructions.length, 4);
  assert.equal(placed.instructions[1].data.readBigUInt64LE(4), 41n);
  assert.equal(placed.order, bidOrder.address);
  const filled = await buildBidTransactionInstructions(market, taker, { action: "fill", order: bidOrder, shares: 30n, minimumProceeds: 15n });
  assert.equal(filled.quote.collateral, 15n);
  assert.equal(filled.instructions.length, 4);
  for (const instruction of filled.instructions.slice(0, 3)) assert.ok(instruction.keys[0].pubkey.equals(taker));
  assert.equal(filled.instructions[3].data.readBigUInt64LE(16), 15n);
  const cancelled = await buildBidTransactionInstructions({ ...market, status: "resolved" }, maker, { action: "cancel", order: bidOrder });
  assert.equal(cancelled.instructions.length, 2);
  assert.ok(cancelled.instructions[1].keys[1].pubkey.equals(NATIVE_MINT));
  for (const change of [{ minimumProceeds: 16n }, { minimumProceeds: -1n }, { shares: 81n }, { order: { ...bidOrder, collateralMint: maker.toBase58() } }, { order: { ...bidOrder, cancelled: true } }]) {
    await assert.rejects(buildBidTransactionInstructions(market, taker, { action: "fill", order: bidOrder, shares: 30n, minimumProceeds: 15n, ...change }));
  }
  await assert.rejects(buildBidTransactionInstructions(market, taker, { action: "cancel", order: bidOrder }));
  await assert.rejects(buildBidTransactionInstructions(market, maker, { action: "fill", order: bidOrder, shares: 30n, minimumProceeds: 15n }));
  await assert.rejects(buildBidTransactionInstructions({ ...market, collateralMint: maker.toBase58() }, maker, operation));
});

test("preparation body limit counts streamed UTF-8 bytes and cancels oversized requests", async () => {
  const text = JSON.stringify({ question: "سوال" });
  assert.equal(await readPreparationBody(new Request("http://localhost", { method: "POST", body: text })), text);
  assert.equal(await readPreparationBody(new Request("http://localhost", { method: "POST", body: "x".repeat(8192) })), "x".repeat(8192));
  let cancelled = false;
  let count = 0;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(4097)); count++; if (count === 3) controller.close(); }, cancel() { cancelled = true; } });
  await assert.rejects(readPreparationBody(new Request("http://localhost", { method: "POST", body: stream, duplex: "half" })), RequestSizeError);
  assert.equal(cancelled, true);
});
