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
