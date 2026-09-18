const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createHash, webcrypto } = require("node:crypto");
const { Keypair, PublicKey, SystemProgram } = require("@solana/web3.js");
const client = require("../.test-build/cookie-markets-program.js");
const { parseTokenAmount, formatTokenAmount } = require("../.test-build/token-amounts.js");
const { validateMarketDraft } = require("../.test-build/protocol.js");
const { decodeProtocolConfig, decodeMarketAccount } = require("../.test-build/protocol-accounts.js");
const { buildPositionTransactionInstructions, buildWrapNativeInstructions } = require("../.test-build/position-transactions.js");
const { readVerifiedProtocol } = require("../.test-build/protocol-reader.js");
const { hashHex, hashMarketTerms } = require("../.test-build/market-terms.js");
const { COOKIE_CHAIN } = require("../.test-build/cookie-chain-config.js");
const { ASSOCIATED_TOKEN_PROGRAM_ID, NATIVE_MINT, deriveAssociatedTokenAddress } = require("../.test-build/token-instructions.js");

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const creator = new PublicKey(Buffer.alloc(32, 1));
const user = Keypair.fromSeed(Buffer.alloc(32, 2)).publicKey;
const collateralMint = new PublicKey(Buffer.alloc(32, 3));
const userCollateral = new PublicKey(Buffer.alloc(32, 4));
const userYes = new PublicKey(Buffer.alloc(32, 5));
const userNo = new PublicKey(Buffer.alloc(32, 6));
const marketNonce = 18446744073709551615n;
const position = { creator, marketNonce, collateralMint, user, userCollateral, userYes, userNo, amount: 123456789n };
const addresses = client.deriveMarketAddresses(creator, marketNonce);

function assertInstruction(instruction, name, keys, args = Buffer.alloc(0)) {
  const discriminator = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  assert.ok(instruction.programId.equals(client.COOKIE_MARKETS_PROGRAM_ID));
  assert.deepEqual(instruction.data, Buffer.concat([discriminator, args]));
  assert.deepEqual(instruction.keys.map(({ pubkey, isWritable, isSigner }) => [pubkey.toBase58(), isWritable, isSigner]), keys.map(([pubkey, isWritable = false, isSigner = false]) => [pubkey.toBase58(), isWritable, isSigner]));
}

function unsigned(value) {
  const bytes = Buffer.alloc(8);
  bytes.writeBigUInt64LE(value);
  return bytes;
}

test("bid builders match Anchor layout and reject unsafe amounts", async () => {
  const identity = { market: addresses.market, maker: creator, nonce: marketNonce, collateralMint };
  const bid = client.deriveBidAddresses(identity.market, creator, marketNonce);
  assert.ok(bid.order.equals(PublicKey.findProgramAddressSync([Buffer.from("bid"), addresses.market.toBuffer(), creator.toBuffer(), unsigned(marketNonce)], client.COOKIE_MARKETS_PROGRAM_ID)[0]));
  assert.ok(bid.escrow.equals(PublicKey.findProgramAddressSync([Buffer.from("bid_escrow"), bid.order.toBuffer()], client.COOKIE_MARKETS_PROGRAM_ID)[0]));
  const place = { creator, marketNonce, maker: creator, nonce: marketNonce, collateralMint, makerCollateral: userCollateral, side: "yes", shares: 80n, price: 500000n, expiresAt: 2000000000n };
  for (const [side, mint, tag] of [["yes", addresses.yesMint, 0], ["no", addresses.noMint, 1]]) {
    assertInstruction(await client.buildPlaceBidInstruction({ ...place, side }), "place_bid",
      [[client.deriveConfigAddress()], [addresses.market], [bid.order, true], [collateralMint], [mint], [bid.escrow, true], [userCollateral, true], [creator, true, true], [client.TOKEN_PROGRAM_ID], [SystemProgram.programId]],
      Buffer.concat([unsigned(marketNonce), Buffer.from([tag]), unsigned(80n), unsigned(500000n), unsigned(2000000000n)]));
  }
  const fill = { ...identity, shareMint: addresses.yesMint, taker: user, takerShares: userYes, makerShares: userNo, takerCollateral: userCollateral, feeCollateral: userCollateral, shares: 30n, minimumProceeds: 15n };
  assertInstruction(await client.buildFillBidInstruction(fill), "fill_bid",
    [[addresses.market], [bid.order, true], [collateralMint], [addresses.yesMint], [bid.escrow, true], [userYes, true], [userNo, true], [userCollateral, true], [userCollateral, true], [user, false, true], [client.TOKEN_PROGRAM_ID]], Buffer.concat([unsigned(30n), unsigned(15n)]));
  assertInstruction(await client.buildCancelBidInstruction({ ...identity, makerCollateral: userCollateral }), "cancel_bid",
    [[bid.order, true], [collateralMint], [bid.escrow, true], [userCollateral, true], [creator, false, true], [client.TOKEN_PROGRAM_ID]]);
  for (const invalid of [{ side: "invalid" }, { shares: 0n }, { shares: marketNonce + 1n }, { price: 0n }, { price: 1000001n }, { expiresAt: 0n }, { expiresAt: 9223372036854775808n }, { nonce: -1n }]) await assert.rejects(client.buildPlaceBidInstruction({ ...place, ...invalid }), RangeError);
  for (const invalid of [{ shares: 0n }, { minimumProceeds: -1n }, { minimumProceeds: marketNonce + 1n }, { taker: creator }]) await assert.rejects(client.buildFillBidInstruction({ ...fill, ...invalid }));
});

test("bid decoder verifies collateral, custody identity, layout, and fee-inclusive bounds", () => {
  const { decodeBidOrder } = require("../.test-build/protocol-accounts.js");
  const market = { address: addresses.market.toBase58(), collateralMint: collateralMint.toBase58(), yesMint: addresses.yesMint.toBase58(), noMint: addresses.noMint.toBase58(), closesAt: "2000000000" };
  const bid = client.deriveBidAddresses(addresses.market, creator, marketNonce);
  const data = Buffer.alloc(213);
  createHash("sha256").update("account:BidOrder").digest().copy(data, 0, 0, 8);
  for (const [key, offset] of [[addresses.market, 8], [creator, 40], [addresses.yesMint, 72], [collateralMint, 104], [user, 136]]) key.toBuffer().copy(data, offset);
  for (const [value, offset] of [[marketNonce, 168], [80n, 176], [30n, 184], [500000n, 192], [2000000000n, 200]]) data.writeBigUInt64LE(value, offset);
  data.writeUInt16LE(30, 208);
  data[211] = bid.bump;
  data[212] = bid.escrowBump;
  const account = { owner: client.COOKIE_MARKETS_PROGRAM_ID, data };
  assert.equal(decodeBidOrder(bid.order, account, market).remainingShares, "50");
  assert.throws(() => decodeBidOrder(user, account, market));
  assert.throws(() => decodeBidOrder(bid.order, { ...account, owner: user }, market));
  assert.throws(() => decodeBidOrder(bid.order, { ...account, data: data.subarray(0, 212) }, market));
  for (const offset of [0, 8, 40, 72, 104, 168, 211, 212]) {
    const corrupted = Buffer.from(data);
    corrupted[offset] ^= 1;
    assert.throws(() => decodeBidOrder(bid.order, { ...account, data: corrupted }, market));
  }
  for (const [value, offset] of [[0n, 176], [81n, 184], [1000001n, 192], [2000000001n, 200]]) {
    const corrupted = Buffer.from(data);
    corrupted.writeBigUInt64LE(value, offset);
    assert.throws(() => decodeBidOrder(bid.order, { ...account, data: corrupted }, market));
  }
  for (const [value, offset] of [[2, 210], [255, 209]]) {
    const corrupted = Buffer.from(data);
    corrupted[offset] = value;
    assert.throws(() => decodeBidOrder(bid.order, { ...account, data: corrupted }, market));
  }
  const overflow = Buffer.from(data);
  overflow.writeBigUInt64LE(marketNonce, 176);
  overflow.writeBigUInt64LE(1000000n, 192);
  assert.throws(() => decodeBidOrder(bid.order, { ...account, data: overflow }, market));
});

test("bid discovery verifies remaining fee budget and sorts best buy price first", async () => {
  const { readVerifiedBids } = require("../.test-build/protocol-reader.js");
  const market = { address: addresses.market.toBase58(), collateralMint: collateralMint.toBase58(), yesMint: addresses.yesMint.toBase58(), noMint: addresses.noMint.toBase58(), closesAt: "2000000000" };
  const orders = [1n, 2n].map((nonce) => {
    const bid = client.deriveBidAddresses(addresses.market, creator, nonce);
    const data = Buffer.alloc(213);
    createHash("sha256").update("account:BidOrder").digest().copy(data, 0, 0, 8);
    for (const [key, offset] of [[addresses.market, 8], [creator, 40], [addresses.yesMint, 72], [collateralMint, 104], [user, 136]]) key.toBuffer().copy(data, offset);
    for (const [value, offset] of [[nonce, 168], [80n, 176], [30n, 184], [nonce * 250000n, 192], [2000000000n, 200]]) data.writeBigUInt64LE(value, offset);
    data.writeUInt16LE(30, 208);
    data[211] = bid.bump;
    data[212] = bid.escrowBump;
    return { pubkey: bid.order, account: { owner: client.COOKIE_MARKETS_PROGRAM_ID, data }, bid };
  });
  const escrows = orders.map(({ bid }, index) => {
    const data = Buffer.alloc(165);
    collateralMint.toBuffer().copy(data, 0);
    bid.order.toBuffer().copy(data, 32);
    data.writeBigUInt64LE(index === 0 ? 12n : 25n, 64);
    data[108] = 1;
    return { owner: client.TOKEN_PROGRAM_ID, data };
  });
  const connection = {
    getProgramAccounts: async (program, options) => {
      assert.ok(program.equals(client.COOKIE_MARKETS_PROGRAM_ID));
      assert.deepEqual(options.filters, [{ dataSize: 213 }, { memcmp: { offset: 8, bytes: market.address } }]);
      return orders;
    },
    getMultipleAccountsInfo: async (keys) => {
      assert.deepEqual(keys, orders.map(({ bid }) => bid.escrow));
      return escrows;
    },
  };
  assert.deepEqual((await readVerifiedBids(connection, market)).map(order => order.price), ["500000", "250000"]);
  escrows[1].data.writeBigUInt64LE(24n, 64);
  await assert.rejects(readVerifiedBids(connection, market), /balance/);
  orders[1].account.data[210] = 1;
  escrows[1].data.writeBigUInt64LE(0n, 64);
  assert.equal((await readVerifiedBids(connection, market))[0].cancelled, true);
  for (const offset of [0, 32, 108]) {
    escrows[0].data[offset] ^= 1;
    await assert.rejects(readVerifiedBids(connection, market), /custody/);
    escrows[0].data[offset] ^= 1;
  }
  await assert.rejects(readVerifiedBids({ ...connection, getMultipleAccountsInfo: async () => [] }, market), /Incomplete/);
  await assert.rejects(readVerifiedBids({ ...connection, getProgramAccounts: async () => Array(1001).fill(orders[0]) }, market), /Too many/);
});

test("ask builders match Anchor layout, account permissions, and full-width nonces", async () => {
  const identity = { market: addresses.market, maker: creator, nonce: marketNonce, shareMint: addresses.yesMint };
  const ask = client.deriveAskAddresses(identity.market, identity.maker, identity.nonce);
  const expected = PublicKey.findProgramAddressSync([Buffer.from("ask"), identity.market.toBuffer(), creator.toBuffer(), unsigned(marketNonce)], client.COOKIE_MARKETS_PROGRAM_ID)[0];
  assert.ok(ask.order.equals(expected));
  assert.ok(ask.escrow.equals(PublicKey.findProgramAddressSync([Buffer.from("ask_escrow"), expected.toBuffer()], client.COOKIE_MARKETS_PROGRAM_ID)[0]));
  for (const [side, mint, tag] of [["yes", addresses.yesMint, 0], ["no", addresses.noMint, 1]]) {
    assertInstruction(await client.buildPlaceAskInstruction({ creator, marketNonce, maker: creator, nonce: marketNonce, collateralMint, makerShares: userYes, side, shares: 80n, price: 500000n, expiresAt: 2000000000n }), "place_ask",
      [[client.deriveConfigAddress()], [addresses.market], [ask.order, true], [collateralMint], [mint], [ask.escrow, true], [userYes, true], [creator, true, true], [client.TOKEN_PROGRAM_ID], [SystemProgram.programId]],
      Buffer.concat([unsigned(marketNonce), Buffer.from([tag]), unsigned(80n), unsigned(500000n), unsigned(2000000000n)]));
  }
  assertInstruction(await client.buildFillAskInstruction({ ...identity, collateralMint, taker: user, takerCollateral: userCollateral, makerCollateral: userNo, feeCollateral: userYes, takerShares: userYes, shares: 30n, maximumDebit: 16n }), "fill_ask",
    [[identity.market], [ask.order, true], [collateralMint], [identity.shareMint], [ask.escrow, true], [userCollateral, true], [userNo, true], [userYes, true], [userYes, true], [user, false, true], [client.TOKEN_PROGRAM_ID]], Buffer.concat([unsigned(30n), unsigned(16n)]));
  assertInstruction(await client.buildCancelAskInstruction({ ...identity, makerShares: userYes }), "cancel_ask",
    [[ask.order, true], [identity.shareMint], [ask.escrow, true], [userYes, true], [creator, false, true], [client.TOKEN_PROGRAM_ID]]);
  const place = { creator, marketNonce, maker: creator, nonce: 1n, collateralMint, makerShares: userYes, side: "yes", shares: 80n, price: 500000n, expiresAt: 2000000000n };
  for (const invalid of [{ side: "invalid" }, { shares: 0n }, { shares: marketNonce + 1n }, { price: 0n }, { price: 1000001n }, { expiresAt: 0n }, { expiresAt: 9223372036854775808n }, { nonce: -1n }]) {
    await assert.rejects(client.buildPlaceAskInstruction({ ...place, ...invalid }), RangeError);
  }
  const fill = { ...identity, collateralMint, taker: user, takerCollateral: userCollateral, makerCollateral: userNo, feeCollateral: userYes, takerShares: userYes, shares: 1n, maximumDebit: 1n };
  for (const invalid of [{ shares: 0n }, { maximumDebit: 0n }, { maximumDebit: marketNonce + 1n }, { taker: creator }]) await assert.rejects(client.buildFillAskInstruction({ ...fill, ...invalid }));
});

test("ask decoder and discovery reject corrupted custody bindings and limits", async () => {
  const { decodeAskOrder } = require("../.test-build/protocol-accounts.js");
  const market = { address: addresses.market.toBase58(), yesMint: addresses.yesMint.toBase58(), noMint: addresses.noMint.toBase58(), closesAt: "2000000000" };
  const ask = client.deriveAskAddresses(addresses.market, creator, marketNonce);
  const data = Buffer.alloc(181);
  createHash("sha256").update("account:AskOrder").digest().copy(data, 0, 0, 8);
  addresses.market.toBuffer().copy(data, 8);
  creator.toBuffer().copy(data, 40);
  addresses.yesMint.toBuffer().copy(data, 72);
  user.toBuffer().copy(data, 104);
  for (const [offset, value] of [[136, marketNonce], [144, 80n], [152, 30n], [160, 500000n], [168, 1900000000n]]) data.writeBigUInt64LE(value, offset);
  data.writeUInt16LE(30, 176);
  data[179] = ask.bump;
  data[180] = ask.escrowBump;
  const account = { owner: client.COOKIE_MARKETS_PROGRAM_ID, data };
  const decoded = decodeAskOrder(ask.order, account, market);
  assert.equal(decoded.remainingShares, "50");
  assert.equal(decoded.nonce, marketNonce.toString());
  assert.equal(decoded.side, "yes");
  assert.equal(decoded.cancelled, false);
  assert.equal(decoded.feeRecipient, user.toBase58());
  assert.throws(() => decodeAskOrder(user, account, market));
  assert.throws(() => decodeAskOrder(ask.order, { ...account, owner: user }, market));
  assert.throws(() => decodeAskOrder(ask.order, { ...account, data: data.subarray(0, 180) }, market));
  for (const offset of [0, 8, 40, 72, 136, 179, 180]) {
    const corrupt = Buffer.from(data);
    corrupt[offset] ^= 255;
    assert.throws(() => decodeAskOrder(ask.order, { ...account, data: corrupt }, market));
  }
  for (const [offset, value] of [[144, 0n], [152, 81n], [160, 0n], [160, 1000001n], [168, 2000000001n]]) {
    const corrupt = Buffer.from(data);
    corrupt.writeBigUInt64LE(value, offset);
    assert.throws(() => decodeAskOrder(ask.order, { ...account, data: corrupt }, market));
  }
  for (const [offset, value] of [[176, 65535], [178, 2]]) {
    const corrupt = Buffer.from(data);
    if (offset === 176) corrupt.writeUInt16LE(value, offset); else corrupt[offset] = value;
    assert.throws(() => decodeAskOrder(ask.order, { ...account, data: corrupt }, market));
  }
  const cancelled = Buffer.from(data);
  cancelled[178] = 1;
  assert.equal(decodeAskOrder(ask.order, { ...account, data: cancelled }, market).cancelled, true);
  const { readVerifiedAsks } = require("../.test-build/protocol-reader.js");
  const escrowData = Buffer.alloc(165);
  addresses.yesMint.toBuffer().copy(escrowData, 0);
  ask.order.toBuffer().copy(escrowData, 32);
  escrowData.writeBigUInt64LE(50n, 64);
  escrowData[108] = 1;
  const escrowAccount = { owner: client.TOKEN_PROGRAM_ID, data: escrowData };
  const connection = {
    async getProgramAccounts(program, options) {
      assert.ok(program.equals(client.COOKIE_MARKETS_PROGRAM_ID));
      assert.deepEqual(options.filters, [{ dataSize: 181 }, { memcmp: { offset: 8, bytes: market.address } }]);
      return [{ pubkey: ask.order, account }];
    },
    async getMultipleAccountsInfo(keys) {
      assert.equal(keys.length, 1);
      assert.ok(keys[0].equals(ask.escrow));
      return [escrowAccount];
    },
  };
  assert.equal((await readVerifiedAsks(connection, market))[0].remainingShares, "50");
  for (const replacement of [null, { ...escrowAccount, owner: user }, { ...escrowAccount, data: escrowData.subarray(0, 164) }]) {
    await assert.rejects(readVerifiedAsks({ ...connection, async getMultipleAccountsInfo() { return [replacement]; } }, market));
  }
  for (const offset of [0, 32, 108]) {
    const corrupt = Buffer.from(escrowData);
    corrupt[offset] ^= 255;
    await assert.rejects(readVerifiedAsks({ ...connection, async getMultipleAccountsInfo() { return [{ ...escrowAccount, data: corrupt }]; } }, market));
  }
  const shortBalance = Buffer.from(escrowData);
  shortBalance.writeBigUInt64LE(49n, 64);
  await assert.rejects(readVerifiedAsks({ ...connection, async getMultipleAccountsInfo() { return [{ ...escrowAccount, data: shortBalance }]; } }, market));
  await assert.rejects(readVerifiedAsks({ ...connection, async getMultipleAccountsInfo() { return []; } }, market));
  await assert.rejects(readVerifiedAsks({ ...connection, async getProgramAccounts() { return Array(1001).fill({ pubkey: ask.order, account }); } }, market));
  assert.deepEqual(await readVerifiedAsks({ ...connection, async getProgramAccounts() { return []; } }, market), []);
});

test("PDA derivation preserves the full unsigned nonce", () => {
  const expected = PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), unsigned(marketNonce)], client.COOKIE_MARKETS_PROGRAM_ID)[0];
  assert.ok(addresses.market.equals(expected));
  for (const [field, seed] of [["yesMint", "yes_mint"], ["noMint", "no_mint"], ["vault", "vault"], ["resolution", "resolution"]]) {
    assert.ok(addresses[field].equals(PublicKey.findProgramAddressSync([Buffer.from(seed), expected.toBuffer()], client.COOKIE_MARKETS_PROGRAM_ID)[0]));
  }
  assert.throws(() => client.deriveMarketAddresses(creator, -1n), RangeError);
  assert.throws(() => client.deriveMarketAddresses(creator, marketNonce + 1n), RangeError);
});

test("protocol initialization matches Anchor arguments and permissions", async () => {
  const fee = Buffer.alloc(2);
  fee.writeUInt16LE(1000);
  assertInstruction(await client.buildInitializeProtocolInstruction({ admin: creator, feeRecipient: user, resolver: creator, collateralMint, feeBps: 1000, challengePeriod: 86400n }), "initialize_protocol", [[client.deriveConfigAddress(), true], [collateralMint], [creator, true, true], [SystemProgram.programId]], Buffer.concat([user.toBuffer(), creator.toBuffer(), fee, unsigned(86400n)]));
});

test("market creation matches the contract wire layout", async () => {
  const questionHash = Buffer.alloc(32, 7);
  const rulesHash = Buffer.alloc(32, 8);
  assertInstruction(await client.buildCreateMarketInstruction({ creator, collateralMint, marketNonce, questionHash, rulesHash, closesAt: 2000000000n, resolveAfter: 2000000100n }), "create_market", [[client.deriveConfigAddress()], [addresses.market, true], [collateralMint], [addresses.yesMint, true], [addresses.noMint, true], [addresses.vault, true], [creator, true, true], [client.TOKEN_PROGRAM_ID], [SystemProgram.programId]], Buffer.concat([unsigned(marketNonce), questionHash, rulesHash, unsigned(2000000000n), unsigned(2000000100n)]));
});

test("position instructions use the correct mints, authorities, and exact amounts", async () => {
  const keys = [[addresses.market, true], [collateralMint], [addresses.yesMint, true], [addresses.noMint, true], [addresses.vault, true], [userCollateral, true], [userYes, true], [userNo, true], [user, false, true], [client.TOKEN_PROGRAM_ID]];
  assertInstruction(await client.buildSplitCollateralInstruction(position), "split_collateral", keys, unsigned(position.amount));
  assertInstruction(await client.buildMergePositionsInstruction(position), "merge_positions", keys, unsigned(position.amount));
  for (const [side, tag] of [["yes", 0], ["no", 1]]) {
    assertInstruction(await client.buildRedeemInstruction({ ...position, side }), "redeem", keys, Buffer.concat([Buffer.from([tag]), unsigned(position.amount)]));
  }
});

test("lifecycle instructions match contract permissions", async () => {
  assertInstruction(await client.buildOpenMarketInstruction(creator, marketNonce), "open_market", [[addresses.market, true], [creator, false, true]]);
  assertInstruction(await client.buildLockMarketInstruction(creator, marketNonce), "lock_market", [[addresses.market, true]]);
  assertInstruction(await client.buildFinalizeResolutionInstruction(creator, marketNonce), "finalize_resolution", [[addresses.market, true], [addresses.resolution]]);
  assertInstruction(await client.buildChallengeResolutionInstruction({ creator, marketNonce, challenger: user }), "challenge_resolution", [[addresses.market], [addresses.resolution, true], [user, false, true]]);
});

test("resolution builders encode all three outcomes", async () => {
  const evidenceHash = Buffer.alloc(32, 9);
  for (const [outcome, tag] of [["yes", 1], ["no", 2], ["invalid", 3]]) {
    const params = { creator, marketNonce, resolver: user, outcome, evidenceHash };
    const args = Buffer.concat([Buffer.from([tag]), evidenceHash]);
    assertInstruction(await client.buildProposeResolutionInstruction(params), "propose_resolution", [[client.deriveConfigAddress()], [addresses.market, true], [addresses.resolution, true], [user, true, true], [SystemProgram.programId]], args);
    assertInstruction(await client.buildResolveChallengeInstruction(params), "resolve_challenge", [[client.deriveConfigAddress()], [addresses.market], [addresses.resolution, true], [user, false, true]], args);
  }
});

test("invalid runtime inputs fail before instructions are constructed", async () => {
  for (const amount of [0n, -1n, marketNonce + 1n]) {
    await assert.rejects(client.buildSplitCollateralInstruction({ ...position, amount }), RangeError);
    await assert.rejects(client.buildMergePositionsInstruction({ ...position, amount }), RangeError);
    await assert.rejects(client.buildRedeemInstruction({ ...position, amount, side: "yes" }), RangeError);
  }
  await assert.rejects(client.buildRedeemInstruction({ ...position, side: "invalid" }), RangeError);
  const resolution = { creator, marketNonce, resolver: user, outcome: "yes", evidenceHash: Buffer.alloc(32, 1) };
  await assert.rejects(client.buildProposeResolutionInstruction({ ...resolution, outcome: "unknown" }), RangeError);
  await assert.rejects(client.buildProposeResolutionInstruction({ ...resolution, evidenceHash: Buffer.alloc(32) }), RangeError);
  await assert.rejects(client.buildResolveChallengeInstruction({ ...resolution, evidenceHash: Buffer.alloc(31) }), RangeError);
  const initialize = { admin: creator, feeRecipient: user, resolver: user, collateralMint, feeBps: 0, challengePeriod: 1n };
  for (const feeBps of [-1, 1001, 0.5, NaN]) await assert.rejects(client.buildInitializeProtocolInstruction({ ...initialize, feeBps }), RangeError);
  await assert.rejects(client.buildInitializeProtocolInstruction({ ...initialize, challengePeriod: 0n }), RangeError);
  const create = { creator, collateralMint, marketNonce, questionHash: Buffer.alloc(32, 1), rulesHash: Buffer.alloc(32, 2), closesAt: 20n, resolveAfter: 30n };
  await assert.rejects(client.buildCreateMarketInstruction({ ...create, questionHash: Buffer.alloc(32) }), RangeError);
  await assert.rejects(client.buildCreateMarketInstruction({ ...create, resolveAfter: 10n }), RangeError);
});

test("token amounts never round through floating point", () => {
  for (const [text, amount] of [["0.000000001", 1n], ["1.23456789", 1234567890n], ["18446744073.709551615", marketNonce]]) {
    assert.equal(parseTokenAmount(text, 9), amount);
    assert.equal(formatTokenAmount(amount, 9), text);
  }
  assert.equal(parseTokenAmount(" 1.000000000 ", 9), 1000000000n);
  assert.equal(formatTokenAmount(0n, 9), "0");
  assert.equal(parseTokenAmount("1", 0), 1n);
  for (const value of ["0", "-1", "+1", "1e3", "NaN", "1,000", "01", ".1", "1.", "0.0000000001", "18446744073.709551616"]) assert.throws(() => parseTokenAmount(value, 9));
  assert.throws(() => parseTokenAmount("1", 19), RangeError);
});

test("market drafts reject past close times and invalid resolution schedules", () => {
  const draft = { question: "Will the publicly measured event happen?", resolutionSource: "Public dataset", resolutionRules: "Yes if it happens; No otherwise; Invalid if the source is unavailable.", closesAt: new Date(Date.now() + 3600000).toISOString(), resolvesAt: new Date(Date.now() + 7200000).toISOString() };
  assert.deepEqual(validateMarketDraft(draft), {});
  assert.ok(validateMarketDraft({ ...draft, closesAt: "2000-01-01T00:00:00Z" }).closesAt);
  assert.ok(validateMarketDraft({ ...draft, resolvesAt: draft.closesAt }).resolvesAt);
});

function accountData(name, size) {
  const data = Buffer.alloc(size);
  createHash("sha256").update(`account:${name}`).digest().copy(data, 0, 0, 8);
  return { owner: client.COOKIE_MARKETS_PROGRAM_ID, data };
}

test("config decoding verifies layout, owner, PDA, bump, and protocol limits", () => {
  const account = accountData("ProtocolConfig", 147);
  collateralMint.toBuffer().copy(account.data, 104);
  account.data.writeBigInt64LE(9223372036854775807n, 138);
  account.data[146] = PublicKey.findProgramAddressSync([Buffer.from("config")], client.COOKIE_MARKETS_PROGRAM_ID)[1];
  const address = client.deriveConfigAddress();
  assert.equal(decodeProtocolConfig(address, account).challengePeriod, "9223372036854775807");
  assert.equal(decodeProtocolConfig(address, account).collateralMint, collateralMint.toBase58());
  assert.throws(() => decodeProtocolConfig(address, { ...account, owner: user }), /owner/);
  assert.throws(() => decodeProtocolConfig(address, { ...account, data: account.data.subarray(0, 146) }), /size/);
  assert.throws(() => decodeProtocolConfig(user, account), /PDA/);
  const corrupted = Buffer.from(account.data);
  corrupted[146] ^= 1;
  assert.throws(() => decodeProtocolConfig(address, { ...account, data: corrupted }), /PDA/);
  corrupted.set(account.data);
  corrupted.writeUInt16LE(1001, 136);
  assert.throws(() => decodeProtocolConfig(address, { ...account, data: corrupted }), /limits/);
  corrupted.set(account.data);
  corrupted.writeBigInt64LE(0n, 138);
  assert.throws(() => decodeProtocolConfig(address, { ...account, data: corrupted }), /limits/);
});

test("market decoding rejects substituted custody accounts and impossible states", () => {
  const account = accountData("Market", 307);
  creator.toBuffer().copy(account.data, 8);
  account.data.writeBigUInt64LE(marketNonce, 40);
  for (const [key, offset] of [[collateralMint, 48], [addresses.yesMint, 80], [addresses.noMint, 112], [addresses.vault, 144], [user, 176]]) key.toBuffer().copy(account.data, offset);
  account.data.fill(1, 208, 272);
  account.data.writeBigInt64LE(2000000000n, 272);
  account.data.writeBigInt64LE(2000000100n, 280);
  account.data[296] = 1;
  account.data.writeBigUInt64LE(marketNonce, 298);
  account.data[306] = PublicKey.findProgramAddressSync([Buffer.from("market"), creator.toBuffer(), unsigned(marketNonce)], client.COOKIE_MARKETS_PROGRAM_ID)[1];
  const decoded = decodeMarketAccount(addresses.market, account);
  assert.equal(decoded.outstandingSets, marketNonce.toString());
  assert.equal(decoded.nonce, marketNonce.toString());
  assert.equal(decoded.status, "open");
  assert.throws(() => decodeMarketAccount(user, account), /PDA/);
  for (const offset of [80, 112, 144]) {
    const data = Buffer.from(account.data);
    user.toBuffer().copy(data, offset);
    assert.throws(() => decodeMarketAccount(addresses.market, { ...account, data }), /custody/);
  }
  for (const [status, outcome] of [[255, 0], [1, 1], [4, 0], [4, 255]]) {
    const data = Buffer.from(account.data);
    data[296] = status;
    data[297] = outcome;
    assert.throws(() => decodeMarketAccount(addresses.market, { ...account, data }), /state/);
  }
  const data = Buffer.from(account.data);
  data[0] ^= 1;
  assert.throws(() => decodeMarketAccount(addresses.market, { ...account, data }), /discriminator/);
});

test("full transaction preparation creates the correct ATAs without signatures", async () => {
  const prepared = await buildPositionTransactionInstructions({ ...position, action: "split" });
  assert.equal(prepared.instructions.length, 4);
  assert.ok(prepared.userCollateral.equals(deriveAssociatedTokenAddress(collateralMint, user)));
  for (const instruction of prepared.instructions.slice(0, 3)) {
    assert.ok(instruction.programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID));
    assert.deepEqual(instruction.data, Buffer.from([1]));
    assert.ok(instruction.keys[0].pubkey.equals(user));
    assert.ok(instruction.keys[0].isSigner);
  }
  const wrapped = await buildPositionTransactionInstructions({ ...position, collateralMint: NATIVE_MINT, action: "split", wrapNative: true });
  assert.equal(wrapped.instructions.length, 6);
  assert.ok(wrapped.instructions[3].programId.equals(SystemProgram.programId));
  assert.equal(wrapped.instructions[3].data.readBigUInt64LE(4), position.amount);
  assert.deepEqual(wrapped.instructions[4].data, Buffer.from([17]));
  assert.ok(wrapped.instructions[4].keys[0].pubkey.equals(wrapped.userCollateral));
  await assert.rejects(buildPositionTransactionInstructions({ ...position, action: "merge", wrapNative: true }), /wrapping/);
  await assert.rejects(buildPositionTransactionInstructions({ ...position, action: "redeem" }), /side/);
  await assert.rejects(buildPositionTransactionInstructions({ ...position, action: "unknown" }), /action/);
  assert.throws(() => buildWrapNativeInstructions(user, 0n), RangeError);
});

test("protocol readiness fails closed on wrong RPC, absent program, or substituted collateral", async () => {
  const config = accountData("ProtocolConfig", 147);
  collateralMint.toBuffer().copy(config.data, 104);
  config.data.writeBigInt64LE(20n, 138);
  config.data[146] = PublicKey.findProgramAddressSync([Buffer.from("config")], client.COOKIE_MARKETS_PROGRAM_ID)[1];
  const mint = { owner: client.TOKEN_PROGRAM_ID, data: Buffer.alloc(82) };
  mint.data[44] = 9;
  mint.data[45] = 1;
  const program = { executable: true };
  const connection = {
    getGenesisHash: async () => COOKIE_CHAIN.genesisHash,
    getAccountInfo: async (address) => address.equals(client.COOKIE_MARKETS_PROGRAM_ID) ? program : address.equals(client.deriveConfigAddress()) ? config : mint,
  };
  assert.equal((await readVerifiedProtocol(connection)).collateralDecimals, 9);
  await assert.rejects(readVerifiedProtocol({ ...connection, getGenesisHash: async () => "wrong-chain" }), /genesis/);
  program.executable = false;
  await assert.rejects(readVerifiedProtocol(connection), /executable/);
  program.executable = true;
  mint.owner = user;
  await assert.rejects(readVerifiedProtocol(connection), /mint/);
  mint.owner = client.TOKEN_PROGRAM_ID;
  mint.data[45] = 0;
  await assert.rejects(readVerifiedProtocol(connection), /mint/);
  assert.equal(await readVerifiedProtocol({ ...connection, getAccountInfo: async () => null }), null);
});

test("price markets commit exact USD thresholds UTC times and timestamped evidence rules", async () => {
  const { createPriceMarketTerms, evaluatePriceMarketObservation, priceUsdUnits } = require("../.test-build/market-terms.js");
  const spec = { asset: "BTC", targetUsd: "100000.00000000", settlesAt: "2030-09-30T18:00:00.000Z", source: "Approved BTC/USD dataset v1" };
  const terms = createPriceMarketTerms(spec);
  assert.match(terms.question, /\$100000 at 2030/);
  assert.match(terms.resolutionRules, /60 seconds/);
  await hashMarketTerms(terms);
  const observation = { asset: "BTC", source: spec.source, priceUsd: "100000", observedAt: spec.settlesAt };
  assert.equal(evaluatePriceMarketObservation(spec, observation), "yes");
  assert.equal(evaluatePriceMarketObservation(spec, { ...observation, priceUsd: "99999.99999999" }), "no");
  assert.equal(evaluatePriceMarketObservation(spec, { ...observation, observedAt: "2030-09-30T17:59:00.000Z" }), "yes");
  for (const change of [{ source: "Other feed" }, { asset: "ETH" }, { observedAt: "2030-09-30T18:00:01.000Z" }, { observedAt: "2030-09-30T17:58:59.000Z" }, { priceUsd: "100000.000000001" }]) assert.throws(() => evaluatePriceMarketObservation(spec, { ...observation, ...change }));
  for (const price of ["0", "-1", "1e5", "NaN", "01", "1.123456789", "1000000000"]) assert.throws(() => priceUsdUnits(price));
  for (const change of [{ asset: "SOL" }, { source: "" }, { source: "feed\nchanged" }, { settlesAt: "2030-02-30T18:00:00.000Z" }, { settlesAt: "2030-09-30T18:00:00+00:00" }]) assert.throws(() => createPriceMarketTerms({ ...spec, ...change }));
  await hashMarketTerms(createPriceMarketTerms({ ...spec, asset: "ETH", targetUsd: "5000" }));
});

test("readable market terms produce the exact committed hashes", async () => {
  const terms = { question: " Will this event happen? ", resolutionSource: " Public source ", resolutionRules: " Yes if the source reports the event; No otherwise. " };
  const hashed = await hashMarketTerms(terms);
  assert.equal(hashHex(hashed.questionHash), createHash("sha256").update(terms.question.trim()).digest("hex"));
  assert.equal(hashHex(hashed.rulesHash), createHash("sha256").update(`${terms.resolutionSource.trim()}\n${terms.resolutionRules.trim()}`).digest("hex"));
  assert.notEqual(hashHex((await hashMarketTerms({ ...terms, resolutionRules: "Changed payout conditions." })).rulesHash), hashHex(hashed.rulesHash));
  await assert.rejects(hashMarketTerms({ ...terms, resolutionSource: "Ambiguous\nsource" }), /single line/);
  await assert.rejects(hashMarketTerms({ ...terms, question: "" }), /Question/);
  await assert.rejects(hashMarketTerms({ ...terms, resolutionRules: "x".repeat(1025) }), /Rules/);
});

test("published terms bind readable text to the exact market, network, program, and hashes", async () => {
  const { createMarketTermsRecord, verifyPublishedMarketTerms } = require("../.test-build/market-terms-record.js");
  const terms = { question: "Will the public source report the event?", resolutionSource: "Public source", resolutionRules: "YES if reported; NO otherwise." };
  const hashed = await hashMarketTerms(terms);
  const market = { address: client.deriveMarketAddresses(creator, marketNonce).market.toBase58(), questionHash: hashHex(hashed.questionHash), rulesHash: hashHex(hashed.rulesHash) };
  const record = await createMarketTermsRecord(market.address, terms);
  assert.deepEqual(await verifyPublishedMarketTerms([record], market), record);
  assert.equal(await verifyPublishedMarketTerms([], market), undefined);
  assert.equal(await verifyPublishedMarketTerms([null, { ...record, market: user.toBase58() }], market), undefined);
  await assert.rejects(verifyPublishedMarketTerms([record, record], market), /Multiple/);
  for (const changes of [{ version: 2 }, { genesisHash: "wrong-chain" }, { program: user.toBase58() }, { question: 42 }, { question: "Changed question" }, { resolutionSource: "Changed source" }, { resolutionRules: "Changed rules" }]) {
    await assert.rejects(verifyPublishedMarketTerms([{ ...record, ...changes }], market));
  }
  await assert.rejects(verifyPublishedMarketTerms([record], { ...market, questionHash: "0".repeat(64) }), /hashes/);
  await assert.rejects(verifyPublishedMarketTerms([record], { ...market, rulesHash: "0".repeat(64) }), /hashes/);
});
