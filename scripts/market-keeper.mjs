import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";

const RPC = process.env.COOKIE_CHAIN_RPC ?? "https://rpc.cookiescan.io";
const GENESIS = "9wDaBRDgArEUpvhHxGguNkwozsZh4UpGZB9o2EoEcBB2";
const PROGRAM = new PublicKey("BNqof3tMVwNd7rthycJTtXkvbGtopihvL9gpeoSk8WaR");
const CONFIG = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM)[0];
const KEYPAIR_PATH = process.env.COOKIE_MARKETS_RESOLVER_KEYPAIR ?? ".local-secrets/cookie-markets-deployer-keypair.json";
const TERMS_ROOT = process.env.COOKIE_MARKETS_TERMS_DIR ?? path.resolve(".local-data/market-terms");
const EVIDENCE_ROOT = process.env.COOKIE_MARKETS_EVIDENCE_DIR ?? path.resolve(".local-data/resolution-evidence");
const connection = new Connection(RPC, "confirmed");

const discriminator = (name) => createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
const marketKey = (data, offset) => new PublicKey(data.subarray(offset, offset + 32));

async function loadResolver() {
  const bytes = JSON.parse(await readFile(KEYPAIR_PATH, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function protocolConfig(resolver) {
  if (await connection.getGenesisHash() !== GENESIS) throw new Error("Resolver refused a non-Cookie Chain RPC.");
  const account = await connection.getAccountInfo(CONFIG, "confirmed");
  if (!account || !account.owner.equals(PROGRAM) || ![147, 149].includes(account.data.length)) throw new Error("Protocol config is unavailable or invalid.");
  const configuredResolver = marketKey(account.data, 72);
  const challengePeriod = account.data.readBigInt64LE(138);
  if (!configuredResolver.equals(resolver.publicKey)) throw new Error(`Keeper is not the configured resolver. Expected ${configuredResolver.toBase58()}.`);
  if (challengePeriod !== 0n) throw new Error(`Automatic finalization requires challenge period 0; current value is ${challengePeriod}.`);
}

async function termsFor(market) {
  const file = path.join(TERMS_ROOT, GENESIS, PROGRAM.toBase58(), `${market.toBase58()}.json`);
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; }
}

async function verifiedTermsFor(market, data) {
  const record = await termsFor(market);
  if (!record || record.market !== market.toBase58() || record.genesisHash !== GENESIS || record.program !== PROGRAM.toBase58()) return undefined;
  if (typeof record.question !== "string" || typeof record.resolutionSource !== "string" || typeof record.resolutionRules !== "string") return undefined;
  const questionHash = createHash("sha256").update(record.question.trim()).digest();
  const rulesHash = createHash("sha256").update(`${record.resolutionSource.trim()}\n${record.resolutionRules.trim()}`).digest();
  return questionHash.equals(data.subarray(208, 240)) && rulesHash.equals(data.subarray(240, 272)) ? record : undefined;
}

function parsePriceTerms(terms, closesAt) {
  const match = /^Will (BTC|ETH)\/USD be (above|under) \$([0-9]+(?:\.[0-9]+)?) at (.+)\?$/.exec(terms?.question ?? "");
  if (!match || Date.parse(match[4]) / 1000 !== closesAt) throw new Error("Readable price terms are missing or do not match the settlement time.");
  return { asset: match[1], direction: match[2], target: match[3] };
}

function compareDecimal(left, right) {
  const units = (value) => { const [whole, fraction = ""] = value.split("."); return BigInt(whole) * 100000000n + BigInt(fraction.padEnd(8, "0")); };
  return units(left) < units(right) ? -1 : units(left) > units(right) ? 1 : 0;
}

async function priceEvidence(market, closesAt, terms) {
  const spec = parsePriceTerms(terms, closesAt);
  const bucket = closesAt - 60;
  const url = `https://api.exchange.coinbase.com/products/${spec.asset}-USD/candles?granularity=60&start=${encodeURIComponent(new Date(bucket * 1000).toISOString())}&end=${encodeURIComponent(new Date(closesAt * 1000).toISOString())}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Coinbase returned ${response.status}.`);
  const raw = await response.text();
  const rows = JSON.parse(raw);
  const row = Array.isArray(rows) ? rows.find((candidate) => Array.isArray(candidate) && Number(candidate[0]) === bucket) : undefined;
  if (!row || row.length !== 6) throw new Error("The exact completed Coinbase candle is unavailable.");
  const close = String(row[4]);
  const comparison = compareDecimal(close, spec.target);
  const yes = spec.direction === "above" ? comparison > 0 : comparison < 0;
  return { outcome: yes ? "yes" : "no", evidence: { version: 1, market: market.toBase58(), source: "Coinbase Exchange", product: `${spec.asset}-USD`, bucketStart: new Date(bucket * 1000).toISOString(), settlement: new Date(closesAt * 1000).toISOString(), close, direction: spec.direction, targetUsd: spec.target, outcome: yes ? "yes" : "no", providerUrl: url, originalResponse: raw } };
}

async function decision(market, closesAt, terms) {
  try {
    return await priceEvidence(market, closesAt, terms);
  } catch (error) {
    return { outcome: "invalid", evidence: { version: 1, market: market.toBase58(), outcome: "invalid", reason: error instanceof Error ? error.message : "Resolution evidence unavailable.", createdAt: new Date().toISOString() } };
  }
}

function resolutionAddress(market) {
  return PublicKey.findProgramAddressSync([Buffer.from("resolution"), market.toBuffer()], PROGRAM)[0];
}

async function settle(resolver, market, creator, nonce, closesAt, terms) {
  const result = await decision(market, closesAt, terms);
  const serialized = Buffer.from(JSON.stringify(result.evidence));
  const evidenceHash = createHash("sha256").update(serialized).digest();
  await mkdir(EVIDENCE_ROOT, { recursive: true });
  await writeFile(path.join(EVIDENCE_ROOT, `${market.toBase58()}.json`), serialized, { flag: "wx", mode: 0o600 }).catch((error) => { if (error?.code !== "EEXIST") throw error; });
  const resolution = resolutionAddress(market);
  const outcomeTag = result.outcome === "yes" ? 1 : result.outcome === "no" ? 2 : 3;
  const lock = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: market, isSigner: false, isWritable: true }], data: discriminator("lock_market") });
  const propose = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: CONFIG, isSigner: false, isWritable: false }, { pubkey: market, isSigner: false, isWritable: true }, { pubkey: resolution, isSigner: false, isWritable: true }, { pubkey: resolver.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }], data: Buffer.concat([discriminator("propose_resolution"), Buffer.from([outcomeTag]), evidenceHash]) });
  const finalize = new TransactionInstruction({ programId: PROGRAM, keys: [{ pubkey: market, isSigner: false, isWritable: true }, { pubkey: resolution, isSigner: false, isWritable: false }], data: discriminator("finalize_resolution") });
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({ feePayer: resolver.publicKey, recentBlockhash: latest.blockhash }).add(lock, propose, finalize);
  const signature = await connection.sendTransaction(transaction, [resolver], { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 });
  await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  console.log(JSON.stringify({ market: market.toBase58(), creator: creator.toBase58(), nonce: nonce.toString(), outcome: result.outcome, signature }));
}

async function runOnce() {
  const resolver = await loadResolver();
  await protocolConfig(resolver);
  const now = Math.floor(Date.now() / 1000);
  const accounts = await connection.getProgramAccounts(PROGRAM, { commitment: "confirmed", filters: [{ dataSize: 307 }] });
  for (const { pubkey, account } of accounts) {
    const data = account.data;
    const status = data[296];
    const closesAt = Number(data.readBigInt64LE(272));
    const resolveAfter = Number(data.readBigInt64LE(280));
    if (status !== 1 || now < closesAt || now < resolveAfter) continue;
    const terms = await verifiedTermsFor(pubkey, data);
    if (!terms) { console.warn(JSON.stringify({ market: pubkey.toBase58(), skipped: "verified production terms unavailable" })); continue; }
    await settle(resolver, pubkey, marketKey(data, 8), data.readBigUInt64LE(40), closesAt, terms);
  }
}

await runOnce();
if (process.argv.includes("--watch")) setInterval(() => void runOnce().catch((error) => console.error(error)), 30_000);
