"use client";

import { FormEvent, useEffect, useState } from "react";
import { PublicKey } from "@solana/web3.js";
import {
  buildCreateMarketInstruction,
  buildOpenMarketInstruction,
  deriveMarketAddresses,
} from "@/lib/cookie-markets-program";
import { MarketDraft, validateMarketDraft } from "@/lib/protocol";
import { createPriceMarketTerms, hashMarketTerms } from "@/lib/market-terms";
import { createMarketTermsRecord, type MarketTermsRecord } from "@/lib/market-terms-record";

const initialDraft: MarketDraft = { question: "", resolutionSource: "", resolutionRules: "", closesAt: "", resolvesAt: "" };

export function MarketDraftForm() {
  const [draft, setDraft] = useState(initialDraft);
  const [priceAsset, setPriceAsset] = useState<"BTC" | "ETH">("BTC");
  const [targetUsd, setTargetUsd] = useState("");
  const [collateralMint, setCollateralMint] = useState("");
  const [errors, setErrors] = useState<ReturnType<typeof validateMarketDraft>>({});
  const [isReady, setIsReady] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState<string>();
  const [preview, setPreview] = useState<InstructionPreview>();
  const [collateralMessage, setCollateralMessage] = useState("Resolving approved collateral…");

  useEffect(() => {
    let cancelled = false;
    void resolveCollateral().then((result) => {
      if (cancelled) return;
      if (result.mint) {
        setCollateralMint(result.mint);
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
    const nextErrors = validateMarketDraft(draft);
    setErrors(nextErrors);
    setIsReady(Object.keys(nextErrors).length === 0);
  }

  function applyPriceTemplate() {
    try {
      const settlesAt = new Date(draft.closesAt).toISOString();
      if (Date.parse(settlesAt) <= Date.now()) throw new Error("Choose a future trading-close time.");
      const terms = createPriceMarketTerms({ asset: priceAsset, targetUsd, settlesAt, source: draft.resolutionSource });
      setDraft({ ...draft, ...terms, resolvesAt: draft.closesAt });
      setIsReady(false);
      setPreview(undefined);
      setPrepareError(undefined);
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Check the price template fields.");
    }
  }

  async function prepareInstructions() {
    const nextErrors = validateMarketDraft(draft);
    setErrors(nextErrors);
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

      setPreview({
        terms: await createMarketTermsRecord(addresses.market.toBase58(), draft),
        creator: creator.toBase58(),
        collateralMint: mint.toBase58(),
        market: addresses.market.toBase58(),
        yesMint: addresses.yesMint.toBase58(),
        noMint: addresses.noMint.toBase58(),
        vault: addresses.vault.toBase58(),
        marketNonce: marketNonce.toString(),
        createData: toBase64(create.data),
        openData: toBase64(open.data),
      });
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : "Could not prepare instructions.");
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <form className="draft-form" onSubmit={review} noValidate>
      <fieldset disabled={isPreparing}>
        <legend>BTC / ETH price market</legend>
        <Field label="Asset"><select value={priceAsset} onChange={(event) => setPriceAsset(event.target.value as "BTC" | "ETH")}><option value="BTC">BTC / USD</option><option value="ETH">ETH / USD</option></select></Field>
        <Field label="Target USD price"><input inputMode="decimal" value={targetUsd} onChange={(event) => setTargetUsd(event.target.value)} placeholder="100000" /></Field>
        <p>Set the exact price dataset below and a future trading-close time, then apply fixed rules. Local time is converted to UTC. Automated price collection is not connected yet.</p>
        <button type="button" onClick={applyPriceTemplate}>Apply price-market rules</button>
      </fieldset>
      <Field label="Market question" error={errors.question}><input value={draft.question} onChange={(event) => update("question", event.target.value)} placeholder="Will…?" /></Field>
      <Field label="Resolution source" error={errors.resolutionSource}><input value={draft.resolutionSource} onChange={(event) => update("resolutionSource", event.target.value)} placeholder="Exact oracle, explorer, publication, or public dataset" /></Field>
      <Field label="Resolution rules" error={errors.resolutionRules}><textarea rows={6} value={draft.resolutionRules} onChange={(event) => update("resolutionRules", event.target.value)} placeholder="Resolves Yes if… Resolves No if… Resolves Invalid if…" /></Field>
      <div className="date-fields">
        <Field label="Trading closes" error={errors.closesAt}><input type="datetime-local" value={draft.closesAt} onChange={(event) => update("closesAt", event.target.value)} /></Field>
        <Field label="Earliest resolution" error={errors.resolvesAt}><input type="datetime-local" value={draft.resolvesAt} onChange={(event) => update("resolvesAt", event.target.value)} /></Field>
      </div>
      <Field label="Collateral token mint"><input value={collateralMint} readOnly placeholder="Resolving wrapped COOK…" /><small className="field-note">{collateralMessage}</small></Field>
      <button className="primary-action form-action" type="submit">Review draft</button>
      {isReady ? <div className="draft-ready"><strong>Draft passes the initial checks.</strong><p>Prepare deterministic accounts and unsigned instructions after entering a verified collateral mint.</p><button type="button" className="secondary-action" disabled={isPreparing || !collateralMint.trim()} onClick={() => void prepareInstructions()}>{isPreparing ? "Preparing…" : "Prepare unsigned instructions"}</button></div> : null}
      {prepareError ? <p className="form-error">{prepareError}</p> : null}
      {preview ? <p><a className="secondary-action" download={`market-${preview.market}.json`} href={`data:application/json;charset=utf-8,${encodeURIComponent(JSON.stringify(preview.terms, null, 2))}`}>Download public market terms</a></p> : null}
      {preview ? <div className="draft-ready"><strong>Unsigned instructions ready.</strong><p>No transaction was sent and Nightly was not asked to sign.</p><dl className="instruction-preview"><div><dt>Market</dt><dd>{preview.market}</dd></div><div><dt>YES mint</dt><dd>{preview.yesMint}</dd></div><div><dt>NO mint</dt><dd>{preview.noMint}</dd></div><div><dt>Vault</dt><dd>{preview.vault}</dd></div><div><dt>Creator</dt><dd>{preview.creator}</dd></div><div><dt>Collateral</dt><dd>{preview.collateralMint}</dd></div><div><dt>Nonce</dt><dd>{preview.marketNonce}</dd></div><div><dt>Create data</dt><dd>{preview.createData}</dd></div><div><dt>Open data</dt><dd>{preview.openData}</dd></div></dl></div> : null}
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
  createData: string;
  openData: string;
};

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

async function resolveCollateral(): Promise<{ mint?: string; message: string }> {
  try {
    const protocolResponse = await fetch("/api/protocol", { cache: "no-store" });
    if (!protocolResponse.ok) {
      return { message: "Protocol verification is unavailable. Collateral preparation is disabled." };
    }
    const protocol = await protocolResponse.json() as { deployed?: boolean; collateralMint?: string };
    if (protocol.deployed && protocol.collateralMint) {
      return { mint: protocol.collateralMint, message: "Loaded from the deployed protocol config." };
    }

    const networkResponse = await fetch("/api/network", { cache: "no-store" });
    const network = await networkResponse.json() as { healthy?: boolean; wrappedCookMint?: string; collateralError?: string; error?: string };
    if (!networkResponse.ok || !network.healthy || !network.wrappedCookMint) {
      return { message: network.collateralError ?? network.error ?? "Cookie Chain collateral could not be verified." };
    }
    return { mint: network.wrappedCookMint, message: "Resolved from the Cookiescan canonical asset registry." };
  } catch {
    return { message: "Wrapped COOK could not be resolved." };
  }
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}{error ? <small>{error}</small> : null}</label>;
}
