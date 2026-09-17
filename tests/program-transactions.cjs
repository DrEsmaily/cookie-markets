const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, sendAndConfirmTransaction } = require("@solana/web3.js");

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

async function expectProgramError(instructions, signers, expected) {
  await assert.rejects(send(instructions, signers), (error) => {
    const output = `${error.message}\n${(error.logs ?? []).join("\n")}`;
    assert.ok(output.includes(expected), `Expected ${expected}, received ${output}`);
    return true;
  });
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
  await send([instruction("initialize_protocol", [meta(config, true), meta(collateral.publicKey), meta(admin.publicKey, true, true), meta(SystemProgram.programId)], admin.publicKey.toBuffer(), admin.publicKey.toBuffer(), Buffer.alloc(2), integer(2))]);
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
  console.log("Local-validator transactions passed: initialization, mint/vault creation, market opening, unauthorized signer, repeated opening, premature locking.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
