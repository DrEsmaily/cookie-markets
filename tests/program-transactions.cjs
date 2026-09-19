const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { NATIVE_MINT, buildUnwrapNativeInstruction, deriveAssociatedTokenAddress } = require("../.test-build/token-instructions.js");
const { buildPositionTransactionInstructions, buildWrapNativeInstructions } = require("../.test-build/position-transactions.js");

const program = new PublicKey("BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR");
const tokenProgram = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const admin = Keypair.generate();
const outsider = Keypair.generate();

function meta(pubkey, isWritable = false, isSigner = false) {
  return { pubkey, isWritable, isSigner };
}

function pda(...seeds) {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => typeof seed === "string" ? Buffer.from(seed) : seed), program)[0];
}

function integer(value) {
  const data = Buffer.alloc(8);
  data.writeBigInt64LE(BigInt(value));
  return data;
}

function instruction(name, keys, ...args) {
  const discriminator = createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
  return new TransactionInstruction({ programId: program, keys, data: Buffer.concat([discriminator, ...args]) });
}

async function send(instructions, signers = [admin]) {
  return sendAndConfirmTransaction(connection, new Transaction().add(...instructions), signers);
}

async function createTokenAccount(mint, owner = admin.publicKey) {
  const account = Keypair.generate();
  await send([
    SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: account.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(165), space: 165, programId: tokenProgram }),
    new TransactionInstruction({ programId: tokenProgram, keys: [meta(account.publicKey, true), meta(mint)], data: Buffer.concat([Buffer.from([18]), owner.toBuffer()]) }),
  ], [admin, account]);
  return account.publicKey;
}

async function expectProgramError(instructions, signers, expected) {
  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = signers[0].publicKey;
  transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signed = new VersionedTransaction(transaction.compileMessage());
  signed.sign(signers);
  const { value } = await connection.simulateTransaction(signed, {
    sigVerify: true,
    commitment: "confirmed",
  });
  assert.ok(value.err, `Expected ${expected}, but simulation succeeded`);
  const output = (value.logs ?? []).join("\n");
  assert.ok(output.includes(expected), `Expected ${expected}, received ${output}`);
}

async function expectCommittedFailure(instructions, signers) {
  const transaction = new Transaction().add(...instructions);
  transaction.feePayer = signers[0].publicKey;
  const latest = await connection.getLatestBlockhash();
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(...signers);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, maxRetries: 0 });
  const result = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  assert.ok(result.value.err, "Expected submitted transaction to fail");
}

async function chainTime() {
  const clock = await connection.getAccountInfo(new PublicKey("SysvarC1ock11111111111111111111111111111111"));
  assert.ok(clock, "Local-validator clock is missing");
  return Number(clock.data.readBigInt64LE(32));
}

async function waitUntil(timestamp) {
  const deadline = Date.now() + 180_000;
  while (await chainTime() < timestamp) {
    assert.ok(Date.now() < deadline, "Local-validator clock did not advance before timeout");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function testSettlement(config, collateralMint) {
  const closesAt = await chainTime() + 120;
  const fixtures = [];
  for (const outcome of [1, 2, 3]) {
    const nonce = integer(outcome + 1);
    const market = pda("market", admin.publicKey.toBuffer(), nonce);
    const yesMint = pda("yes_mint", market.toBuffer());
    const noMint = pda("no_mint", market.toBuffer());
    const vault = pda("vault", market.toBuffer());
    const resolution = pda("resolution", market.toBuffer());
    await send([instruction("create_market", [meta(config), meta(market, true), meta(collateralMint), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(admin.publicKey, true, true), meta(tokenProgram), meta(SystemProgram.programId)], nonce, Buffer.alloc(32, outcome), Buffer.alloc(32, outcome + 3), integer(closesAt), integer(closesAt))]);
    const userCollateral = await createTokenAccount(collateralMint);
    const userYes = await createTokenAccount(yesMint);
    const userNo = await createTokenAccount(noMint);
    await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(userCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(100)]) })]);
    const positionAccounts = [meta(market, true), meta(collateralMint), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(userCollateral, true), meta(userYes, true), meta(userNo, true), meta(admin.publicKey, false, true), meta(tokenProgram)];
    await send([instruction("open_market", [meta(market, true), meta(admin.publicKey, false, true)]), instruction("split_collateral", positionAccounts, integer(100))]);
    const proposalAccounts = [meta(config), meta(market, true), meta(resolution, true), meta(admin.publicKey, true, true), meta(SystemProgram.programId)];
    await expectProgramError([instruction("propose_resolution", proposalAccounts, Buffer.from([outcome]), Buffer.alloc(32, 1))], [admin], "InvalidMarketState");
    fixtures.push({ outcome, market, yesMint, noMint, vault, resolution, userCollateral, userYes, userNo, positionAccounts, proposalAccounts });
  }
  await waitUntil(closesAt);
  for (const fixture of fixtures) {
    const { outcome, market, resolution, positionAccounts, proposalAccounts } = fixture;
    await expectProgramError([instruction("split_collateral", positionAccounts, integer(1))], [admin], "MarketAlreadyClosed");
    await send([instruction("lock_market", [meta(market, true)])]);
    assert.equal((await connection.getAccountInfo(market)).data[296], 2);
    const unauthorizedProposal = [...proposalAccounts];
    unauthorizedProposal[3] = meta(outsider.publicKey, true, true);
    await expectProgramError([instruction("propose_resolution", unauthorizedProposal, Buffer.from([outcome]), Buffer.alloc(32, 1))], [outsider], "ConstraintHasOne");
    await expectProgramError([instruction("propose_resolution", proposalAccounts, Buffer.from([0]), Buffer.alloc(32, 1))], [admin], "InvalidResolutionOutcome");
    await expectProgramError([instruction("propose_resolution", proposalAccounts, Buffer.from([outcome]), Buffer.alloc(32))], [admin], "EmptyEvidenceHash");
    await send([instruction("propose_resolution", proposalAccounts, Buffer.from([outcome === 3 ? 1 : outcome]), Buffer.alloc(32, 1))]);
    assert.equal((await connection.getAccountInfo(market)).data[296], 3);
    const finalization = instruction("finalize_resolution", [meta(market, true), meta(resolution)]);
    await expectProgramError([finalization], [admin], "ChallengeWindowOpen");
    await expectProgramError([instruction("redeem", positionAccounts, Buffer.from([0]), integer(100))], [admin], "InvalidMarketState");
    if (outcome === 3) {
      await send([instruction("challenge_resolution", [meta(market), meta(resolution, true), meta(outsider.publicKey, false, true)])], [outsider]);
      await expectProgramError([finalization], [admin], "ResolutionChallenged");
      await expectProgramError([instruction("challenge_resolution", [meta(market), meta(resolution, true), meta(outsider.publicKey, false, true)])], [outsider], "AlreadyChallenged");
      await expectProgramError([instruction("resolve_challenge", [meta(config), meta(market), meta(resolution, true), meta(outsider.publicKey, false, true)], Buffer.from([3]), Buffer.alloc(32, 2))], [outsider], "ConstraintHasOne");
      await send([instruction("resolve_challenge", [meta(config), meta(market), meta(resolution, true), meta(admin.publicKey, false, true)], Buffer.from([3]), Buffer.alloc(32, 2))]);
      await expectProgramError([finalization], [admin], "ChallengeWindowOpen");
    }
    const proposal = await connection.getAccountInfo(resolution);
    await waitUntil(Number(proposal.data.readBigInt64LE(113)));
    await send([finalization]);
    const settled = await connection.getAccountInfo(market);
    assert.equal(settled.data[296], 4);
    assert.equal(settled.data[297], outcome);
    await expectProgramError([finalization], [admin], "InvalidMarketState");
    await expectProgramError([instruction("merge_positions", positionAccounts, integer(1))], [admin], "InvalidMarketState");
    if (outcome === 3) {
      await expectProgramError([instruction("redeem", positionAccounts, Buffer.from([0]), integer(1))], [admin], "InvalidRedemptionAmount");
      assert.equal((await connection.getTokenAccountBalance(fixture.userYes)).value.amount, "100");
      await send([instruction("redeem", positionAccounts, Buffer.from([0]), integer(100))]);
      assert.equal((await connection.getTokenAccountBalance(fixture.vault)).value.amount, "50");
      await send([instruction("redeem", positionAccounts, Buffer.from([1]), integer(100))]);
    } else {
      const winningSide = outcome - 1;
      await expectProgramError([instruction("redeem", positionAccounts, Buffer.from([1 - winningSide]), integer(100))], [admin], "LosingPosition");
      assert.equal((await connection.getTokenAccountBalance(fixture.vault)).value.amount, "100");
      await send([instruction("redeem", positionAccounts, Buffer.from([winningSide]), integer(100))]);
      assert.equal((await connection.getTokenAccountBalance(winningSide === 0 ? fixture.userYes : fixture.userNo)).value.amount, "0");
      await expectProgramError([instruction("redeem", positionAccounts, Buffer.from([winningSide]), integer(100))], [admin], "insufficient funds");
    }
    assert.equal((await connection.getTokenAccountBalance(fixture.userCollateral)).value.amount, "100");
    assert.equal((await connection.getTokenAccountBalance(fixture.vault)).value.amount, "0");
    assert.equal((await connection.getAccountInfo(market)).data.readBigUInt64LE(298), 0n);
  }
  console.log("Settlement passed: YES, NO, challenged INVALID, exact refunds, losing-share rejection, challenge deadlines, unauthorized resolution, and double-redemption rejection.");
}

async function testClientPositions(config, collateralMint) {
  const nonce = integer(5);
  const market = pda("market", admin.publicKey.toBuffer(), nonce);
  const yesMint = pda("yes_mint", market.toBuffer());
  const noMint = pda("no_mint", market.toBuffer());
  const vault = pda("vault", market.toBuffer());
  const closesAt = await chainTime() + 3600;
  await send([instruction("create_market", [meta(config), meta(market, true), meta(collateralMint), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(admin.publicKey, true, true), meta(tokenProgram), meta(SystemProgram.programId)], nonce, Buffer.alloc(32, 5), Buffer.alloc(32, 6), integer(closesAt), integer(closesAt))]);
  await send([instruction("open_market", [meta(market, true), meta(admin.publicKey, false, true)])]);
  const params = { creator: admin.publicKey, marketNonce: 5n, collateralMint, user: admin.publicKey, amount: 100n, action: "split" };
  const deposit = await buildPositionTransactionInstructions(params);
  await send(deposit.instructions.slice(0, 3));
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(deposit.userCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(100)]) })]);
  await send(deposit.instructions);
  for (const account of [deposit.userYes, deposit.userNo, vault]) assert.equal((await connection.getTokenAccountBalance(account)).value.amount, "100");
  await testOrders(config, collateralMint, market, yesMint, noMint, deposit.userYes, deposit.userCollateral, vault, closesAt);
  await testBids(collateralMint, market, yesMint, noMint, deposit.userYes, deposit.userNo, deposit.userCollateral, vault, closesAt);
  const withdrawal = await buildPositionTransactionInstructions({ ...params, action: "merge" });
  await send(withdrawal.instructions);
  assert.equal((await connection.getTokenAccountBalance(deposit.userCollateral)).value.amount, "160");
  for (const account of [deposit.userYes, deposit.userNo, vault]) assert.equal((await connection.getTokenAccountBalance(account)).value.amount, "0");
  console.log("Frontend transaction builders passed on validator: idempotent ATA setup, exact collateral deposit, YES/NO issuance, and complete-set withdrawal.");
}

async function testBids(collateralMint, market, yesMint, noMint, sellerYes, sellerNo, sellerCollateral, backingVault, closesAt) {
  const client = require("../.test-build/cookie-markets-program.js");
  const { decodeBidOrder, decodeMarketAccount } = require("../.test-build/protocol-accounts.js");
  const verifiedMarket = decodeMarketAccount(market, await connection.getAccountInfo(market));
  const buyerCollateral = await createTokenAccount(collateralMint, outsider.publicKey);
  const mintBudget = (amount) => new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(buyerCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(amount)]) });
  for (const [side, shareMint, sellerShares, nonce, shares, price, budget, firstShares, firstPayment, secondShares, secondPayment, refund] of [
    ["yes", yesMint, sellerYes, 1n, 80n, 500000n, 41n, 30n, 15n, 20n, 10n, 15n],
    ["no", noMint, sellerNo, 2n, 20n, 333333n, 8n, 10n, 4n, 10n, 3n, 0n],
  ]) {
    const buyerShares = await createTokenAccount(shareMint, outsider.publicKey);
    const identity = { market, maker: outsider.publicKey, nonce, collateralMint };
    const { order, escrow } = client.deriveBidAddresses(market, outsider.publicKey, nonce);
    const beforeBuyer = BigInt((await connection.getTokenAccountBalance(buyerCollateral)).value.amount);
    await send([mintBudget(budget)]);
    const place = await client.buildPlaceBidInstruction({ creator: admin.publicKey, marketNonce: 5n, maker: outsider.publicKey, nonce, collateralMint, makerCollateral: buyerCollateral, side, shares, price, expiresAt: BigInt(closesAt) });
    await send([place], [outsider]);
    assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, budget.toString());
    assert.equal((await connection.getTokenAccountBalance(buyerCollateral)).value.amount, beforeBuyer.toString());
    await expectProgramError([place], [outsider], "already in use");
    const params = { ...identity, shareMint, taker: admin.publicKey, takerShares: sellerShares, makerShares: buyerShares, takerCollateral: sellerCollateral, feeCollateral: sellerCollateral };
    const fill = (amount, minimumProceeds) => client.buildFillBidInstruction({ ...params, shares: amount, minimumProceeds });
    await expectProgramError([await fill(shares + 1n, 0n)], [admin], "InvalidAmount");
    await expectProgramError([await fill(firstShares, firstPayment + 1n)], [admin], "Slippage");
    const substituted = await fill(firstShares, firstPayment);
    substituted.keys[3] = meta(side === "yes" ? noMint : yesMint);
    await expectProgramError([substituted], [admin], "ConstraintHasOne");
    const wrongFee = await fill(firstShares, firstPayment);
    wrongFee.keys[8] = meta(buyerCollateral, true);
    await expectProgramError([wrongFee], [admin], "ConstraintRaw");
    const emptyShares = await createTokenAccount(shareMint);
    const failed = await client.buildFillBidInstruction({ ...params, takerShares: emptyShares, shares: firstShares, minimumProceeds: firstPayment });
    await expectCommittedFailure([failed], [admin]);
    assert.equal((await connection.getAccountInfo(order)).data.readBigUInt64LE(184), 0n);
    assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, budget.toString());
    await send([await fill(firstShares, firstPayment)]);
    assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, (budget - firstPayment - 1n).toString());
    await send([await fill(secondShares, secondPayment)]);
    assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, refund.toString());
    const decoded = decodeBidOrder(order, await connection.getAccountInfo(order), verifiedMarket);
    assert.equal(decoded.filledShares, (firstShares + secondShares).toString());
    assert.equal(decoded.side, side);
    assert.equal((await connection.getTokenAccountBalance(buyerShares)).value.amount, decoded.filledShares);
    const cancel = await client.buildCancelBidInstruction({ ...identity, makerCollateral: buyerCollateral });
    const unauthorized = await client.buildCancelBidInstruction({ ...identity, maker: admin.publicKey, makerCollateral: sellerCollateral });
    unauthorized.keys[0] = meta(order, true);
    unauthorized.keys[2] = meta(escrow, true);
    await expectProgramError([unauthorized], [admin], "ConstraintSeeds");
    await send([cancel], [outsider]);
    assert.equal((await connection.getTokenAccountBalance(buyerCollateral)).value.amount, (beforeBuyer + refund).toString());
    assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, "0");
    assert.equal(decodeBidOrder(order, await connection.getAccountInfo(order), verifiedMarket).cancelled, true);
    await expectProgramError([cancel], [outsider], "Cancelled");
    await expectProgramError([await fill(1n, 0n)], [admin], "Cancelled");
    await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(buyerShares, true), meta(shareMint), meta(sellerShares, true), meta(outsider.publicKey, false, true)], data: Buffer.concat([Buffer.from([12]), integer(firstShares + secondShares), Buffer.from([9])]) })], [outsider]);
    assert.equal((await connection.getTokenAccountBalance(backingVault)).value.amount, "100");
  }
  assert.equal((await connection.getTokenAccountBalance(sellerCollateral)).value.amount, "60");
  console.log("Bid escrow passed: upfront fee-inclusive funding, YES/NO partial fills, seller fee-recipient aliasing, protection limits, rollback, cancellation refunds, and unchanged backing.");
}

async function testOrders(config, collateralMint, market, yesMint, noMint, makerShares, makerCollateral, backingVault, closesAt) {
  const order = pda("ask", market.toBuffer(), admin.publicKey.toBuffer(), integer(1));
  const escrow = pda("ask_escrow", order.toBuffer());
  const takerCollateral = await createTokenAccount(collateralMint, outsider.publicKey);
  const takerShares = await createTokenAccount(yesMint, outsider.publicKey);
  const feeCollateral = await createTokenAccount(collateralMint);
  const placeKeys = [meta(config), meta(market), meta(order, true), meta(collateralMint), meta(yesMint), meta(escrow, true), meta(makerShares, true), meta(admin.publicKey, true, true), meta(tokenProgram), meta(SystemProgram.programId)];
  const client = require("../.test-build/cookie-markets-program.js");
  const { decodeAskOrder, decodeMarketAccount } = require("../.test-build/protocol-accounts.js");
  const place = await client.buildPlaceAskInstruction({ creator: admin.publicKey, marketNonce: 5n, maker: admin.publicKey, nonce: 1n, collateralMint, makerShares, side: "yes", shares: 80n, price: 500000n, expiresAt: BigInt(closesAt) });
  assert.deepEqual(place.keys, placeKeys);
  await send([place]);
  assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, "80");
  assert.equal((await connection.getTokenAccountBalance(makerShares)).value.amount, "20");
  await expectProgramError([place], [admin], "already in use");
  const fillKeys = [meta(market), meta(order, true), meta(collateralMint), meta(yesMint), meta(escrow, true), meta(takerCollateral, true), meta(makerCollateral, true), meta(feeCollateral, true), meta(takerShares, true), meta(outsider.publicKey, false, true), meta(tokenProgram)];
  const fill = (shares, limit) => instruction("fill_ask", fillKeys, integer(shares), integer(limit));
  await expectProgramError([fill(81, 100)], [outsider], "InvalidAmount");
  await expectProgramError([fill(30, 15)], [outsider], "Slippage");
  const substituted = [...fillKeys];
  substituted[3] = meta(noMint);
  await expectProgramError([instruction("fill_ask", substituted, integer(30), integer(16))], [outsider], "ConstraintHasOne");
  const substitutedFee = [...fillKeys];
  substitutedFee[7] = meta(takerCollateral, true);
  await expectProgramError([instruction("fill_ask", substitutedFee, integer(30), integer(16))], [outsider], "ConstraintRaw");
  const mintCollateral = (value) => new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(takerCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(value)]) });
  await send([mintCollateral(16)]);
  const identity = { market, maker: admin.publicKey, nonce: 1n, shareMint: yesMint };
  const fillParams = { ...identity, collateralMint, taker: outsider.publicKey, takerCollateral, makerCollateral, feeCollateral, takerShares };
  const firstFill = await client.buildFillAskInstruction({ ...fillParams, shares: 30n, maximumDebit: 16n });
  assert.deepEqual(firstFill.keys, fillKeys);
  await send([firstFill], [outsider]);
  assert.equal((await connection.getTokenAccountBalance(takerShares)).value.amount, "30");
  assert.equal((await connection.getTokenAccountBalance(makerCollateral)).value.amount, "15");
  assert.equal((await connection.getTokenAccountBalance(feeCollateral)).value.amount, "1");
  await expectCommittedFailure([fill(20, 10)], [outsider]);
  assert.equal((await connection.getAccountInfo(order)).data.readBigUInt64LE(152), 30n);
  assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, "50");
  assert.equal((await connection.getTokenAccountBalance(takerShares)).value.amount, "30");
  await send([mintCollateral(10)]);
  await send([await client.buildFillAskInstruction({ ...fillParams, shares: 20n, maximumDebit: 10n })], [outsider]);
  const verifiedMarket = decodeMarketAccount(market, await connection.getAccountInfo(market));
  const decoded = decodeAskOrder(order, await connection.getAccountInfo(order), verifiedMarket);
  assert.equal(decoded.filledShares, "50");
  assert.equal(decoded.remainingShares, "30");
  assert.equal(decoded.escrow, escrow.toBase58());
  assert.equal((await connection.getTokenAccountBalance(makerCollateral)).value.amount, "25");
  assert.equal((await connection.getTokenAccountBalance(feeCollateral)).value.amount, "1");
  const cancelKeys = [meta(order, true), meta(yesMint), meta(escrow, true), meta(makerShares, true), meta(admin.publicKey, false, true), meta(tokenProgram)];
  const badCancel = [...cancelKeys];
  badCancel[4] = meta(outsider.publicKey, false, true);
  await expectProgramError([instruction("cancel_ask", badCancel)], [outsider], "ConstraintSeeds");
  const cancellation = await client.buildCancelAskInstruction({ ...identity, makerShares });
  assert.deepEqual(cancellation.keys, cancelKeys);
  await send([cancellation]);
  assert.equal(decodeAskOrder(order, await connection.getAccountInfo(order), verifiedMarket).cancelled, true);
  assert.equal((await connection.getTokenAccountBalance(escrow)).value.amount, "0");
  assert.equal((await connection.getTokenAccountBalance(makerShares)).value.amount, "50");
  await expectProgramError([fill(1, 1)], [outsider], "Cancelled");
  await expectProgramError([instruction("cancel_ask", cancelKeys)], [admin], "Cancelled");
  assert.equal((await connection.getTokenAccountBalance(backingVault)).value.amount, "100");
  assert.equal((await connection.getAccountInfo(market)).data.readBigUInt64LE(298), 100n);
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(takerShares, true), meta(yesMint), meta(makerShares, true), meta(outsider.publicKey, false, true)], data: Buffer.concat([Buffer.from([12]), integer(50), Buffer.from([9])]) })], [outsider]);
  const { buildAskTransactionInstructions } = require("../.test-build/ask-transactions.js");
  const assembledPlace = await buildAskTransactionInstructions(verifiedMarket, admin.publicKey, { action: "place", nonce: 2n, side: "yes", shares: 10n, price: 500000n, expiresAt: BigInt(closesAt) });
  await send(assembledPlace.instructions);
  const assembledOrderAddress = new PublicKey(assembledPlace.order);
  const assembledOrder = decodeAskOrder(assembledOrderAddress, await connection.getAccountInfo(assembledOrderAddress), verifiedMarket);
  const assembledFill = await buildAskTransactionInstructions(verifiedMarket, outsider.publicKey, { action: "fill", order: assembledOrder, shares: 10n, maximumDebit: 6n });
  await send(assembledFill.instructions.slice(0, 4), [outsider]);
  const buyerCollateralAta = assembledFill.instructions[0].keys[1].pubkey;
  const buyerSharesAta = assembledFill.instructions[1].keys[1].pubkey;
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(buyerCollateralAta, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(6)]) })]);
  const latest = await connection.getLatestBlockhash("confirmed");
  const unsignedFill = new Transaction({ feePayer: outsider.publicKey, ...latest }).add(...assembledFill.instructions);
  const preview = await connection.simulateTransaction(new VersionedTransaction(unsignedFill.compileMessage()), { sigVerify: false, commitment: "confirmed" });
  assert.equal(preview.value.err, null, JSON.stringify(preview.value.logs));
  assert.equal((await connection.getTokenAccountBalance(buyerCollateralAta)).value.amount, "6");
  assert.equal((await connection.getTokenAccountBalance(buyerSharesAta)).value.amount, "0");
  await send(assembledFill.instructions, [outsider]);
  assert.equal((await connection.getTokenAccountBalance(buyerCollateralAta)).value.amount, "0");
  assert.equal((await connection.getTokenAccountBalance(buyerSharesAta)).value.amount, "10");
  assert.equal((await connection.getTokenAccountBalance(makerCollateral)).value.amount, "31");
  const assembledCancel = await buildAskTransactionInstructions(verifiedMarket, admin.publicKey, { action: "cancel", order: decodeAskOrder(assembledOrderAddress, await connection.getAccountInfo(assembledOrderAddress), verifiedMarket) });
  await send(assembledCancel.instructions);
  const resale = await buildAskTransactionInstructions(verifiedMarket, outsider.publicKey, { action: "place", nonce: 1n, side: "yes", shares: 10n, price: 500000n, expiresAt: BigInt(closesAt) });
  await send(resale.instructions, [outsider]);
  const resaleAddress = new PublicKey(resale.order);
  const resaleOrder = decodeAskOrder(resaleAddress, await connection.getAccountInfo(resaleAddress), verifiedMarket);
  const buyback = await buildAskTransactionInstructions(verifiedMarket, admin.publicKey, { action: "fill", order: resaleOrder, shares: 10n, maximumDebit: 6n });
  assert.equal(buyback.quote.buyerDebit, 6n);
  await send(buyback.instructions);
  assert.equal((await connection.getTokenAccountBalance(makerCollateral)).value.amount, "26");
  assert.equal((await connection.getTokenAccountBalance(buyerCollateralAta)).value.amount, "5");
  assert.equal((await connection.getTokenAccountBalance(makerShares)).value.amount, "100");
  assert.equal((await connection.getTokenAccountBalance(buyerSharesAta)).value.amount, "0");
  console.log("Fee-recipient aliasing passed: seller/fee recipient shares one ATA, buyer/fee recipient shares one ATA, and exact net balances preserve full backing.");
  console.log("Assembled ask transactions passed: buyer-paid recipient ATAs, unsigned simulation leaves balances unchanged, real test execution transfers shares/collateral, and cancellation.");
  console.log("Ask escrow passed: partial fills, cumulative fees, slippage, substituted mint, submitted rollback, maker-only cancellation, replay rejection, and unchanged backing.");
}

async function testNativeWrapping() {
  const startingBalance = await connection.getBalance(admin.publicKey);
  const account = deriveAssociatedTokenAddress(NATIVE_MINT, admin.publicKey);
  await send(buildWrapNativeInstructions(admin.publicKey, 100000000n));
  assert.equal((await connection.getTokenAccountBalance(account)).value.amount, "100000000");
  await send([buildUnwrapNativeInstruction(admin.publicKey)]);
  assert.equal(await connection.getAccountInfo(account), null);
  assert.ok(await connection.getBalance(admin.publicKey) >= startingBalance - 100000, "Unwrapping did not return native collateral and rent minus test transaction fees");
  console.log("Native wrapping passed: frontend ATA/transfer/sync instructions, exact wrapped balance, explicit unwrap, and rent return.");
}

async function testAmmInitialization(config, collateralMint) {
  const client = require("../.test-build/cookie-markets-program.js");
  const nonce = integer(6);
  const market = pda("market", admin.publicKey.toBuffer(), nonce);
  const yesMint = pda("yes_mint", market.toBuffer());
  const noMint = pda("no_mint", market.toBuffer());
  const vault = pda("vault", market.toBuffer());
  const closesAt = await chainTime() + 3600;
  await send([instruction("create_market", [meta(config), meta(market, true), meta(collateralMint), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(admin.publicKey, true, true), meta(tokenProgram), meta(SystemProgram.programId)], nonce, Buffer.alloc(32, 7), Buffer.alloc(32, 8), integer(closesAt), integer(closesAt))]);
  await send([instruction("open_market", [meta(market, true), meta(admin.publicKey, false, true)])]);
  const creatorCollateral = await createTokenAccount(collateralMint);
  const creatorYes = await createTokenAccount(yesMint);
  const creatorNo = await createTokenAccount(noMint);
  const liquidity = 1_000_000_000_000n;
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateralMint, true), meta(creatorCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(liquidity)]) })]);
  await send([await client.buildInitializeAmmInstruction({ market, collateralMint, yesMint, noMint, vault, creator: admin.publicKey, creatorCollateral, creatorYes, creatorNo, liquidity, yesProbabilityBps: 6_000 })]);
  const { pool, poolYes, poolNo } = client.deriveAmmAddresses(market);
  assert.ok(await connection.getAccountInfo(pool));
  assert.equal((await connection.getTokenAccountBalance(vault)).value.amount, liquidity.toString());
  assert.equal((await connection.getTokenAccountBalance(poolYes)).value.amount, "666666666666");
  assert.equal((await connection.getTokenAccountBalance(poolNo)).value.amount, liquidity.toString());
  assert.equal((await connection.getTokenAccountBalance(creatorYes)).value.amount, "333333333334");
  assert.equal((await connection.getTokenAccountBalance(creatorNo)).value.amount, "0");
  console.log("AMM initialization passed on validator: minimum real liquidity, pool creation, custody, initial odds, and creator inventory.");
}

async function main() {
  assert.equal((await connection.getAccountInfo(program)).executable, true);
  for (const signer of [admin, outsider]) {
    const signature = await connection.requestAirdrop(signer.publicKey, 10_000_000_000);
    const latest = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  }

  const collateral = Keypair.generate();
  const initializeMintData = Buffer.concat([Buffer.from([0, 9]), admin.publicKey.toBuffer(), Buffer.from([0]), Buffer.alloc(32)]);
  await send([
    SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: collateral.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(82), space: 82, programId: tokenProgram }),
    new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateral.publicKey, true), meta(new PublicKey("SysvarRent111111111111111111111111111111111"))], data: initializeMintData }),
  ], [admin, collateral]);

  const config = pda("config");
  await send([instruction("initialize_protocol", [meta(config, true), meta(collateral.publicKey), meta(admin.publicKey, true, true), meta(SystemProgram.programId)], admin.publicKey.toBuffer(), admin.publicKey.toBuffer(), Buffer.from([30, 0]), integer(20))]);
  const configAccount = await connection.getAccountInfo(config);
  assert.equal(configAccount.data.length, 147);
  assert.ok(configAccount.owner.equals(program));
  assert.ok(new PublicKey(configAccount.data.subarray(104, 136)).equals(collateral.publicKey));

  const nonce = integer(1);
  const market = pda("market", admin.publicKey.toBuffer(), nonce);
  const yesMint = pda("yes_mint", market.toBuffer());
  const noMint = pda("no_mint", market.toBuffer());
  const vault = pda("vault", market.toBuffer());
  const now = Math.floor(Date.now() / 1000);
  await send([instruction("create_market", [meta(config), meta(market, true), meta(collateral.publicKey), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(admin.publicKey, true, true), meta(tokenProgram), meta(SystemProgram.programId)], nonce, Buffer.alloc(32, 1), Buffer.alloc(32, 2), integer(now + 3600), integer(now + 7200))]);
  let marketAccount = await connection.getAccountInfo(market);
  assert.equal(marketAccount.data.length, 307);
  assert.equal(marketAccount.data[296], 0);
  assert.ok(new PublicKey(marketAccount.data.subarray(80, 112)).equals(yesMint));
  assert.equal((await connection.getTokenAccountBalance(vault)).value.amount, "0");

  await expectProgramError([instruction("open_market", [meta(market, true), meta(outsider.publicKey, false, true)])], [outsider], "Constraint");
  assert.equal((await connection.getAccountInfo(market)).data[296], 0);
  await send([instruction("open_market", [meta(market, true), meta(admin.publicKey, false, true)])]);
  marketAccount = await connection.getAccountInfo(market);
  assert.equal(marketAccount.data[296], 1);
  await expectProgramError([instruction("open_market", [meta(market, true), meta(admin.publicKey, false, true)])], [admin], "InvalidMarketState");
  await expectProgramError([instruction("lock_market", [meta(market, true)])], [admin], "MarketStillOpen");
  const userCollateral = await createTokenAccount(collateral.publicKey);
  const userYes = await createTokenAccount(yesMint);
  const userNo = await createTokenAccount(noMint);
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(collateral.publicKey, true), meta(userCollateral, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([7]), integer(1_000_000_000)]) })]);
  const positionAccounts = [meta(market, true), meta(collateral.publicKey), meta(yesMint, true), meta(noMint, true), meta(vault, true), meta(userCollateral, true), meta(userYes, true), meta(userNo, true), meta(admin.publicKey, false, true), meta(tokenProgram)];
  async function assertBalances(collateralAmount, yesAmount, vaultAmount, noAmount = yesAmount) {
    for (const [account, amount] of [[userCollateral, collateralAmount], [userYes, yesAmount], [userNo, noAmount], [vault, vaultAmount]]) {
      assert.equal((await connection.getTokenAccountBalance(account)).value.amount, String(amount));
    }
    assert.equal((await connection.getAccountInfo(market)).data.readBigUInt64LE(298), BigInt(vaultAmount));
  }
  await expectProgramError([instruction("split_collateral", positionAccounts, integer(0))], [admin], "ZeroAmount");
  await send([instruction("split_collateral", positionAccounts, integer(600_000_000))]);
  await assertBalances(400_000_000, 600_000_000, 600_000_000);
  await expectProgramError([instruction("split_collateral", positionAccounts, integer(500_000_000))], [admin], "insufficient funds");
  await assertBalances(400_000_000, 600_000_000, 600_000_000);
  await send([instruction("merge_positions", positionAccounts, integer(200_000_000))]);
  await assertBalances(600_000_000, 400_000_000, 400_000_000);
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(userNo, true), meta(noMint, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([8]), integer(1)]) })]);
  await expectCommittedFailure([instruction("merge_positions", positionAccounts, integer(400_000_000))], [admin]);
  await assertBalances(600_000_000, 400_000_000, 400_000_000, 399_999_999);
  await send([new TransactionInstruction({ programId: tokenProgram, keys: [meta(userYes, true), meta(yesMint, true), meta(admin.publicKey, false, true)], data: Buffer.concat([Buffer.from([8]), integer(1)]) })]);
  await send([instruction("merge_positions", positionAccounts, integer(399_999_999))]);
  assert.equal((await connection.getTokenAccountBalance(userCollateral)).value.amount, "999999999");
  for (const account of [userYes, userNo]) assert.equal((await connection.getTokenAccountBalance(account)).value.amount, "0");
  assert.equal((await connection.getTokenAccountBalance(vault)).value.amount, "1");
  assert.equal((await connection.getAccountInfo(market)).data.readBigUInt64LE(298), 1n);
  console.log("Collateral custody passed: split, partial merge, submitted rollback after the first burn, and deliberate share burns leave their matching collateral locked.");
  console.log("Local-validator transactions passed: initialization, mint/vault creation, market opening, unauthorized signer, repeated opening, premature locking.");
  await testClientPositions(config, collateral.publicKey);
  await testAmmInitialization(config, collateral.publicKey);
  await testSettlement(config, collateral.publicKey);
  await testNativeWrapping();
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
