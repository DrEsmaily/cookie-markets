const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, VersionedTransaction, sendAndConfirmTransaction } = require("@solana/web3.js");

const program = new PublicKey("US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx");
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

async function createTokenAccount(mint) {
  const account = Keypair.generate();
  await send([
    SystemProgram.createAccount({ fromPubkey: admin.publicKey, newAccountPubkey: account.publicKey, lamports: await connection.getMinimumBalanceForRentExemption(165), space: 165, programId: tokenProgram }),
    new TransactionInstruction({ programId: tokenProgram, keys: [meta(account.publicKey, true), meta(mint)], data: Buffer.concat([Buffer.from([18]), admin.publicKey.toBuffer()]) }),
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
  await send([instruction("initialize_protocol", [meta(config, true), meta(collateral.publicKey), meta(admin.publicKey, true, true), meta(SystemProgram.programId)], admin.publicKey.toBuffer(), admin.publicKey.toBuffer(), Buffer.alloc(2), integer(20))]);
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
  async function assertBalances(collateralAmount, positionAmount, vaultAmount) {
    for (const [account, amount] of [[userCollateral, collateralAmount], [userYes, positionAmount], [userNo, positionAmount], [vault, vaultAmount]]) {
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
  await expectProgramError([instruction("merge_positions", positionAccounts, integer(500_000_000))], [admin], "insufficient funds");
  await assertBalances(600_000_000, 400_000_000, 400_000_000);
  await send([instruction("merge_positions", positionAccounts, integer(400_000_000))]);
  await assertBalances(1_000_000_000, 0, 0);
  console.log("Collateral custody passed: split, partial merge, full refund, zero amount, insufficient funds, and unchanged balances after rejected instructions.");
  console.log("Local-validator transactions passed: initialization, mint/vault creation, market opening, unauthorized signer, repeated opening, premature locking.");
  await testSettlement(config, collateral.publicKey);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
