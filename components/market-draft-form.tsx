"use client";

import { FormEvent, useState } from "react";
import { MarketDraft, validateMarketDraft } from "@/lib/protocol";

const initialDraft: MarketDraft = { question: "", resolutionSource: "", resolutionRules: "", closesAt: "", resolvesAt: "" };

export function MarketDraftForm() {
  const [draft, setDraft] = useState(initialDraft);
  const [errors, setErrors] = useState<ReturnType<typeof validateMarketDraft>>({});
  const [isReady, setIsReady] = useState(false);

  function update(field: keyof MarketDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
    setIsReady(false);
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateMarketDraft(draft);
    setErrors(nextErrors);
    setIsReady(Object.keys(nextErrors).length === 0);
  }

  return (
    <form className="draft-form" onSubmit={review} noValidate>
      <Field label="Market question" error={errors.question}><input value={draft.question} onChange={(event) => update("question", event.target.value)} placeholder="Will…?" /></Field>
      <Field label="Resolution source" error={errors.resolutionSource}><input value={draft.resolutionSource} onChange={(event) => update("resolutionSource", event.target.value)} placeholder="Exact oracle, explorer, publication, or public dataset" /></Field>
      <Field label="Resolution rules" error={errors.resolutionRules}><textarea rows={6} value={draft.resolutionRules} onChange={(event) => update("resolutionRules", event.target.value)} placeholder="Resolves Yes if… Resolves No if… Resolves Invalid if…" /></Field>
      <div className="date-fields">
        <Field label="Trading closes" error={errors.closesAt}><input type="datetime-local" value={draft.closesAt} onChange={(event) => update("closesAt", event.target.value)} /></Field>
        <Field label="Earliest resolution" error={errors.resolvesAt}><input type="datetime-local" value={draft.resolvesAt} onChange={(event) => update("resolvesAt", event.target.value)} /></Field>
      </div>
      <button className="primary-action form-action" type="submit">Review draft</button>
      {isReady ? <div className="draft-ready"><strong>Draft passes the initial checks.</strong><p>Program creation remains disabled until collateral, resolver, and deployment details are approved.</p></div> : null}
    </form>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return <label className="form-field"><span>{label}</span>{children}{error ? <small>{error}</small> : null}</label>;
}
