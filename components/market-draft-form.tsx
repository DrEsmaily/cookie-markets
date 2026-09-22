"use client";

import { FormEvent, useEffect, useState } from "react";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  buildCreateMarketInstruction,
  buildInitializeAmmInstruction,
  buildOpenMarketInstruction,
  deriveMarketAddresses,
} from "@/lib/cookie-markets-program";
import { MarketDraft, validateMarketDraft } from "@/lib/protocol";
import { createPriceMarketTerms, coinbasePriceMarketSpec, hashMarketTerms } from "@/lib/market-terms";
import { formatMarketText } from "@/lib/market-lifecycle";
import { createMarketTermsRecord, type MarketTermsRecord } from "@/lib/market-terms-record";
import { cookieChainConnection } from "@/lib/cookie-chain";
import { COOKIE_CHAIN } from "@/lib/cookie-chain-config";
import { buildCreateAssociatedTokenInstruction, buildSyncNativeInstruction, deriveAssociatedTokenAddress, NATIVE_MINT } from "@/lib/token-instructions";
import { parseTokenAmount } from "@/lib/token-amounts";
import { readApiResponse } from "@/lib/api-response";

const initialDraft: MarketDraft = { question: "", resolutionSource: "", resolutionRules: "", closesAt: "", resolvesAt: "" };

export function MarketDraftForm() {
  const [draft, setDraft] = useState(initialDraft);
  const [priceAsset, setPriceAsset] = useState<"BTC" | "ETH">("BTC");
  const [direction, setDirection] = useState<"above" | "under">("above");
  const [targetUsd, setTargetUsd] = useState("");
  const [initialLiquidity, setInitialLiquidity] = useState("100");
  const [yesProbability, setYesProbability] = useState("50");
  const [collateralMint, setCollateralMint] = useState("");
  const [collateralDecimals, setCollateralDecimals] = useState(9);
  const [isReady, setIsReady] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string>();
  const [preview, setPreview] = useState<InstructionPreview>();
  const [submissionMessage, setSubmissionMessage] = useState<string>();
  const [collateralMessage, setCollateralMessage] = useState("Resolving approved collateral…");

  useEffect(() => {
    let cancelled = false;
    void resolveCollateral().then((result) => {
      if (cancelled) return;
      if (result.mint) {
        setCollateralMint(result.mint);
        setCollateralDecimals(result.decimals ?? 9);
        setCollateralMessage(result.message);
      } else {
        setCollateralMessage(result.message);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(field: keyof MarketDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setIsReady(false);
    setPreview(undefined);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      if (!targetUsd.trim()) throw new Error("Enter a target USD price.");
      if (Number(initialLiquidity) < 100) throw new Error("Initial liquidity must be at least 100 COOK so the strict 1% trade cap still permits a whole share purchase.");
      if (!Number.isInteger(Number(yesProbability)) || Number(yesProbability) < 1 || Number(yesProbability) > 99) throw new Error("Starting YES must be between 1% and 99%.");
      if (!draft.closesAt) throw new Error("Choose a future settlement date and time.");
      const settlement = new Date(draft.closesAt);
      if (!Number.isFinite(settlement.getTime())) throw new Error("Choose a valid settlement date and time.");
      const settlesAt = settlement.toISOString();
      const terms = createPriceMarketTerms(coinbasePriceMarketSpec(priceAsset, targetUsd, settlesAt, direction));
      const nextDraft = { ...draft, ...terms, resolvesAt: new Date(settlement.getTime() + 60_000).toISOString() };
      const nextErrors = validateMarketDraft(nextDraft);
      setDraft(nextDraft);
      const error = Object.values(nextErrors)[0];
      setIsReady(!error);
      setPreview(undefined);
      setPrepareError(error);
    } catch (error) {
      setIsReady(false);
      setPrepareError(error instanceof Error ? error.message : "Check the asset, target, and closing time.");
    }
  }

  async function prepareInstructions() {
    const nextErrors = validateMarketDraft(draft);
    setPrepareError(undefined);
    setPreview(undefined);
    if (Object.keys(nextErrors).length > 0) return;

    setIsPreparing(true);
    try {
      const connect = window.nightly?.solana?.features?.["standard:connect"];
      if (!connect) throw new Error("Install Nightly before preparing a market transaction.");
      const account = (await connect.connect()).accounts[0];
      if (!account) throw new Error("Nightly did not share an account.");

      const creator = new PublicKey(account.address);
      const mint = new PublicKey(collateralMint.trim());
      const marketNonce = randomUnsigned64();
      const { questionHash, rulesHash } = await hashMarketTerms(draft);
      const create = await buildCreateMarketInstruction({
        creator,
        collateralMint: mint,
        marketNonce,
        questionHash,
        rulesHash,
        closesAt: timestampSeconds(draft.closesAt),
        resolveAfter: timestampSeconds(draft.resolvesAt),
      });
      const open = await buildOpenMarketInstruction(creator, marketNonce);
      const addresses = deriveMarketAddresses(creator, marketNonce);
      const liquidity = parseTokenAmount(initialLiquidity, collateralDecimals);
      const creatorCollateral = deriveAssociatedTokenAddress(mint, creator);
      const creatorYes = deriveAssociatedTokenAddress(addresses.yesMint, creator);
      const creatorNo = deriveAssociatedTokenAddress(addresses.noMint, creator);
      const initialize = await buildInitializeAmmInstruction({ market: addresses.market, collateralMint: mint, yesMint: addresses.yesMint, noMint: addresses.noMint, vault: addresses.vault, creator, creatorCollateral, creatorYes, creatorNo, liquidity, yesProbabilityBps: Number(yesProbability) * 100 });
      const latest = await cookieChainConnection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: creator, recentBlockhash: latest.blockhash }).add(create, open, buildCreateAssociatedTokenInstruction(creator, mint), buildCreateAssociatedTokenInstruction(creator, addresses.yesMint), buildCreateAssociatedTokenInstruction(creator, addresses.noMint));
      if (mint.equals(NATIVE_MINT)) transaction.add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: creatorCollateral, lamports: liquidity }), buildSyncNativeInstruction(creatorCollateral));
      transaction.add(initialize);
      const simulation = await cookieChainConnection.simulateTransaction(transaction);
      if (simulation.value.err) throw new Error("Cookie Chain rejected the market simulation.");
      const fee = await transaction.getEstimatedFee(cookieChainConnection);
      if (fee === null) throw new Error("Could not estimate the network fee.");

      setPreview({
        terms: await createMarketTermsRecord(addresses.market.toBase58(), draft),
        creator: creator.toBase58(),
        collateralMint: mint.toBase58(),
        market: addresses.market.toBase58(),
        yesMint: addresses.yesMint.toBase58(),
        noMint: addresses.noMint.toBase58(),
        vault: addresses.vault.toBase58(),
        marketNonce: marketNonce.toString(),
        liquidity: liquidity.toString(),
        yesProbabilityBps: Number(yesProbability) * 100,
        createData: toBase64(create.data),
        openData: toBase64(open.data),
        fee,
        blockHeight: latest.lastValidBlockHeight,
      });
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Could not prepare instructions.");
    } finally {
      setIsPreparing(false);
    }
  }

  async function createMarket() {
    if (!preview) return;
    setIsPreparing(true); setPrepareError(undefined); setSubmissionMessage("Approve the transaction in Nightly. Your market will open automatically after confirmation.");
    try {
      const wallet = window.nightly?.solana;
      const connect = wallet?.features?.["standard:connect"];
      if (!wallet || !connect || wallet.genesisHash !== COOKIE_CHAIN.genesisHash) throw new Error("Connect Nightly to Cookie Chain first.");
      const account = (await connect.connect()).accounts[0];
      if (!account || account.address !== preview.creator) throw new Error("Reconnect the wallet that prepared this market.");
      const creator = new PublicKey(preview.creator);
      const terms = preview.terms;
      const hashes = await hashMarketTerms(terms);
      const create = await buildCreateMarketInstruction({ creator, collateralMint: new PublicKey(preview.collateralMint), marketNonce: BigInt(preview.marketNonce), questionHash: hashes.questionHash, rulesHash: hashes.rulesHash, closesAt: timestampSeconds(draft.closesAt), resolveAfter: timestampSeconds(draft.resolvesAt) });
      const open = await buildOpenMarketInstruction(creator, BigInt(preview.marketNonce));
      const addresses = deriveMarketAddresses(creator, BigInt(preview.marketNonce));
      const mint = new PublicKey(preview.collateralMint);
      const creatorCollateral = deriveAssociatedTokenAddress(mint, creator);
      const creatorYes = deriveAssociatedTokenAddress(addresses.yesMint, creator);
      const creatorNo = deriveAssociatedTokenAddress(addresses.noMint, creator);
      const initialize = await buildInitializeAmmInstruction({ market: addresses.market, collateralMint: mint, yesMint: addresses.yesMint, noMint: addresses.noMint, vault: addresses.vault, creator, creatorCollateral, creatorYes, creatorNo, liquidity: BigInt(preview.liquidity), yesProbabilityBps: preview.yesProbabilityBps });
      const latest = await cookieChainConnection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({ feePayer: creator, recentBlockhash: latest.blockhash }).add(create, open, buildCreateAssociatedTokenInstruction(creator, mint), buildCreateAssociatedTokenInstruction(creator, addresses.yesMint), buildCreateAssociatedTokenInstruction(creator, addresses.noMint));
      if (mint.equals(NATIVE_MINT)) transaction.add(SystemProgram.transfer({ fromPubkey: creator, toPubkey: creatorCollateral, lamports: BigInt(preview.liquidity) }), buildSyncNativeInstruction(creatorCollateral));
      transaction.add(initialize);
      const serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      const chain = account.chains?.find((value) => value.startsWith("solana:")) as `${string}:${string}` | undefined;
      const sendFeature = wallet.features?.["solana:signAndSendTransaction"] ?? wallet.features?.["standard:signAndSendTransaction"];
      const signFeature = wallet.features?.["solana:signTransaction"] ?? wallet.features?.["standard:signTransaction"];
      let signature: string;
      if (signFeature) {
        const result = await signFeature.signTransaction({ account, transaction: serialized, chain, options: { preflightCommitment: "confirmed" } });
        const signed = result[0]?.signedTransaction;
        if (!signed?.length) throw new Error("Nightly did not return a signed transaction.");
        setSubmissionMessage("Signed successfully. Sending the market transaction to Cookie Chain…");
        signature = await cookieChainConnection.sendRawTransaction(signed, { preflightCommitment: "confirmed", maxRetries: 3, skipPreflight: false });
      } else if (sendFeature && chain) {
        const result = await sendFeature.signAndSendTransaction({ account, transaction: serialized, chain, options: { commitment: "confirmed", preflightCommitment: "confirmed", maxRetries: 3 } });
        if (!result[0]?.signature?.length) throw new Error("Nightly did not return a transaction signature.");
        signature = base58Encode(result[0].signature);
      } else throw new Error("Nightly transaction signing is unavailable.");
      setSubmissionMessage("Transaction sent. Confirming the new market on Cookie Chain…");
      const confirmation = await withTimeout(cookieChainConnection.confirmTransaction({ signature, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, "confirmed"), 60_000, "Cookie Chain confirmation is taking longer than expected. The transaction was sent; do not submit it again.");
      if (confirmation.value.err) throw new Error("Cookie Chain rejected the signed market transaction.");
      setSubmissionMessage("Market confirmed. Publishing its settlement terms…");
      const publication = await withTimeout(fetch("/api/protocol", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ market: preview.market, question: terms.question, resolutionSource: terms.resolutionSource, resolutionRules: terms.resolutionRules }) }), 30_000, "The market is live, but publishing its terms timed out. Do not recreate it; retry from the downloaded terms file.");
      const publicationResult = await readApiResponse<{ error?: string }>(publication, "Public market terms could not be stored.");
      if (!publication.ok) throw new Error(`Market is live, but public terms publication failed: ${publicationResult.error ?? "unknown error"}. Do not recreate the market.`);
      setSubmissionMessage("Market confirmed. Opening it now…");
      window.location.assign(`/markets/${preview.market}`);
    } catch (error) {
      setSubmissionMessage(undefined);
      setPrepareError(error instanceof Error ? error.message : "Market submission failed.");
    }
    finally { setIsPreparing(false); }
  }

  return (
    <form className="draft-form" onSubmit={review} noValidate>
      <fieldset disabled={isPreparing}>
        <legend>Create a price market</legend>
        <Field label="Which asset?"><select value={priceAsset} onChange={(event) => { setPriceAsset(event.target.value as "BTC" | "ETH"); setIsReady(false); setPreview(undefined); }}><option value="BTC">Bitcoin (BTC)</option><option value="ETH">Ethereum (ETH)</option></select></Field>
        <Field label="Price direction"><select value={direction} onChange={(event) => { setDirection(event.target.value as "above" | "under"); setIsReady(false); setPreview(undefined); }}><option value="above">Above</option><option value="under">Under</option></select></Field>
        <Field label="Target USD price"><input inputMode="decimal" value={targetUsd} onChange={(event) => { setTargetUsd(event.target.value); setIsReady(false); setPreview(undefined); }} placeholder="82000" /></Field>
        <Field label="At this date and time"><input type="datetime-local" value={draft.closesAt} onChange={(event) => update("closesAt", event.target.value)} /></Field>
        <Field label="Initial liquidity (minimum 100 COOK)"><input inputMode="decimal" value={initialLiquidity} onChange={(event) => { setInitialLiquidity(event.target.value); setIsReady(false); setPreview(undefined); }} /><small>At 100 COOK, the 1% per-transaction cap is 1 COOK, enough for whole-share trading.</small></Field>
        <Field label="Starting YES percentage"><input type="number" min="1" max="99" step="1" value={yesProbability} onChange={(event) => { setYesProbability(event.target.value); setIsReady(false); setPreview(undefined); }} /><small>NO starts at {100 - (Number(yesProbability) || 0)}%</small></Field>
        <p>CookieMarkets automatically creates the question and uses Coinbase Exchange’s preceding one-minute candle close for settlement.</p>
      </fieldset>
      <button className="primary-action form-action" type="submit">Review market</button>
      {prepareError ? <p className="form-error" role="alert">{prepareError}</p> : null}
      {isReady ? <div className="draft-ready"><strong>{formatMarketText(draft.question)}</strong><p>Settlement source: Coinbase Exchange · Collateral: COOK (wrapped automatically for the on-chain program)</p><details><summary>View exact settlement rules</summary><p>{formatMarketText(draft.resolutionRules)}</p><p>{collateralMessage}</p></details><button type="button" className="secondary-action" disabled={isPreparing || !collateralMint.trim()} onClick={() => void prepareInstructions()}>{isPreparing ? "Checking on-chain costs…" : "Prepare real market"}</button></div> : null}
      {preview ? <p><a className="secondary-action" download={`market-${preview.market}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(preview.terms, null, 2))}`}>Download public market terms</a></p> : null}
      {preview ? <div className="draft-ready"><strong>Simulation passed. Review before approving.</strong><p>This creates and opens the market atomically. Account rent is additional to the estimated network fee.</p><dl className="instruction-preview"><div><dt>Market</dt><dd>{preview.market}</dd></div><div><dt>YES mint</dt><dd>{preview.yesMint}</dd></div><div><dt>NO mint</dt><dd>{preview.noMint}</dd></div><div><dt>Vault</dt><dd>{preview.vault}</dd></div><div><dt>Creator</dt><dd>{preview.creator}</dd></div><div><dt>Collateral</dt><dd>{preview.collateralMint}</dd></div><div><dt>Nonce</dt><dd>{preview.marketNonce}</dd></div><div><dt>Network fee</dt><dd>{preview.fee} base units</dd></div><div><dt>Block expiry</dt><dd>{preview.blockHeight}</dd></div><div><dt>Create data</dt><dd>{preview.createData}</dd></div><div><dt>Open data</dt><dd>{preview.openData}</dd></div></dl><button type="button" className="primary-action" disabled={isPreparing || Boolean(submissionMessage)} onClick={() => void createMarket()}>{isPreparing ? "Waiting for Nightly…" : "Create real market in Nightly"}</button>{submissionMessage ? <p role="status"><strong>{submissionMessage}</strong></p> : null}</div> : null}
    </form>
  );
}

type InstructionPreview = {
  terms: MarketTermsRecord;
  creator: string;
  collateralMint: string;
  market: string;
  yesMint: string;
  noMint: string;
  vault: string;
  marketNonce: string;
  liquidity: string;
  yesProbabilityBps: number;
  createData: string;
  openData: string;
  fee: number;
  blockHeight: number;
};

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timeout = window.setTimeout(() => reject(new Error(message)), milliseconds); }),
    ]);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
  }
}

function base58Encode(bytes: Uint8Array) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) { digits.push(carry % 58); carry = Math.floor(carry / 58); }
  }
  let result = "";
  for (let index = 0; index < bytes.length - 1 && bytes[index] === 0; index += 1) result += "1";
  for (let index = digits.length - 1; index >= 0; index -= 1) result += alphabet[digits[index]];
  return result;
}

function randomUnsigned64(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return new DataView(bytes.buffer).getBigUint64(0, true);
}

function timestampSeconds(value: string): bigint {
  return BigInt(Math.floor(new Date(value).getTime() / 1_000));
}

function toBase64(value: Uint8Array): string {
  return btoa(Array.from(value, (byte) => String.fromCharCode(byte)).join(""));
}

async function resolveCollateral(): Promise<{ mint?: string; decimals?: number; message: string }> {
  try {
    const protocolResponse = await fetch("/api/protocol", { cache: "no-store" });
    if (!protocolResponse.ok) {
      return { message: "Protocol verification is unavailable. Collateral preparation is disabled." };
    }
    const protocol = await readApiResponse<{ deployed?: boolean; collateralMint?: string; collateralDecimals?: number }>(protocolResponse, "Protocol verification returned an unreadable response.");
    if (protocol.deployed && protocol.collateralMint) {
      return { mint: protocol.collateralMint, decimals: protocol.collateralDecimals, message: "Loaded from the deployed protocol config." };
    }

    const networkResponse = await fetch("/api/network", { cache: "no-store" });
    const network = await readApiResponse<{ healthy?: boolean; wrappedCookMint?: string; collateralError?: string; error?: string }>(networkResponse, "Network verification returned an unreadable response.");
    if (!networkResponse.ok || !network.healthy || !network.wrappedCookMint) {
      return { message: network.collateralError ?? network.error ?? "Cookie Chain collateral could not be verified." };
    }
    return { mint: network.wrappedCookMint, message: "Resolved from the Cookiescan canonical asset registry." };
  } catch {
    return { message: "COOK collateral could not be resolved." };
  }
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}{error ? <small>{error}</small> : null}</label>;
}
