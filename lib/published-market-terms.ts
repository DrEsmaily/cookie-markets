import type { MarketTermsRecord } from "./market-terms-record";
import { verifyPublishedMarketTerms } from "./market-terms-record";
import { PublicKey } from "@solana/web3.js";
import { open, readFile, stat, mkdir, link, unlink, readdir } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { randomUUID } from "node:crypto";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { COOKIE_CHAIN } from "./cookie-chain-config";
import { COOKIE_MARKETS_PROGRAM_ID } from "./cookie-markets-program";

export const publishedMarketTerms: readonly MarketTermsRecord[] = [];

type TermsStore = {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string): Promise<void>;
};

async function cloudflareTermsStore(): Promise<TermsStore | undefined> {
  try {
    const context = await getCloudflareContext({ async: true });
    const store = (context.env as Record<string, unknown>).COOKIE_MARKETS_TERMS;
    if (store && typeof store === "object" && "get" in store && "put" in store) return store as TermsStore;
  } catch {
    // Local development uses the persistent filesystem store below.
  }
  return undefined;
}

function storageDirectory(directory = process.env.COOKIE_MARKETS_TERMS_DIR) {
  if (!directory && process.env.NODE_ENV !== "production") directory = join(process.cwd(), ".local-data", "market-terms");
  if (!directory) return undefined;
  if (!isAbsolute(directory)) throw new Error("COOKIE_MARKETS_TERMS_DIR must be an absolute persistent directory.");
  return join(directory, COOKIE_CHAIN.genesisHash, COOKIE_MARKETS_PROGRAM_ID.toBase58());
}

function recordPath(directory: string, market: string) {
  if (new PublicKey(market).toBase58() !== market) throw new Error("Invalid market address.");
  return join(directory, `${market}.json`);
}

export async function readPublishedMarketTerms(market: string, directory?: string): Promise<readonly unknown[]> {
  const bundled = publishedMarketTerms.filter((record) => record.market === market);
  const store = await cloudflareTermsStore();
  if (store) {
    const record = await store.get(market, "json");
    if (!record) return bundled;
    if (!record || typeof record !== "object" || !("market" in record) || record.market !== market) throw new Error("Stored terms do not identify the requested market.");
    if (bundled.length && JSON.stringify(record) !== JSON.stringify(bundled[0])) throw new Error("Stored and bundled market terms conflict.");
    return [record];
  }
  const storage = storageDirectory(directory);
  if (!storage) return bundled;
  const path = recordPath(storage, market);
  try {
    if ((await stat(path)).size > 8192) throw new Error("Stored market terms are too large.");
    const record: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!record || typeof record !== "object" || !("market" in record) || record.market !== market) throw new Error("Stored terms do not identify the requested market.");
    if (bundled.length) {
      if (JSON.stringify(record) !== JSON.stringify(bundled[0])) throw new Error("Stored and bundled market terms conflict.");
      return bundled;
    }
    return [record];
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return bundled;
    throw error;
  }
}

export async function publishVerifiedMarketTerms(record: MarketTermsRecord, market: { address: string; questionHash: string; rulesHash: string }, directory?: string) {
  const verified = await verifyPublishedMarketTerms([record], market);
  if (!verified) throw new Error("Terms record does not identify this market.");
  const store = await cloudflareTermsStore();
  if (store) {
    const existing = await readPublishedMarketTerms(market.address, directory);
    if (existing.length) { await verifyPublishedMarketTerms(existing, market); return { created: false }; }
    await store.put(market.address, JSON.stringify(verified));
    return { created: true };
  }
  const storage = storageDirectory(directory);
  if (!storage) throw new Error("Persistent terms storage is not configured. Configure COOKIE_MARKETS_TERMS_DIR on a backed-up persistent volume.");
  const existing = await readPublishedMarketTerms(market.address, directory);
  if (existing.length) { await verifyPublishedMarketTerms(existing, market); return { created: false }; }
  await mkdir(storage, { recursive: true, mode: 0o700 });
  if ((await readdir(storage)).filter((name) => name.endsWith(".json")).length >= 1000) throw new Error("Terms storage capacity reached. Operator action is required.");
  const path = recordPath(storage, market.address);
  const temporary = join(storage, `.terms-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(verified), "utf8");
    await file.sync();
  } finally { await file.close(); }
  try {
    await link(temporary, path);
    return { created: true };
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      await verifyPublishedMarketTerms(await readPublishedMarketTerms(market.address, directory), market);
      return { created: false };
    }
    throw error;
  } finally { await unlink(temporary); }
}
