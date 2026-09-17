export type MarketTerms = { question: string; resolutionSource: string; resolutionRules: string };

export async function hashMarketTerms(terms: MarketTerms) {
  const normalized = {
    question: terms.question.trim(),
    resolutionSource: terms.resolutionSource.trim(),
    resolutionRules: terms.resolutionRules.trim(),
  };
  const encoder = new TextEncoder();
  if (!normalized.question || encoder.encode(normalized.question).length > 280) throw new Error("Question must contain 1–280 bytes.");
  if (!normalized.resolutionSource || /[\r\n]/.test(normalized.resolutionSource) || encoder.encode(normalized.resolutionSource).length > 256) throw new Error("Resolution source must contain 1–256 bytes on a single line.");
  if (!normalized.resolutionRules || encoder.encode(normalized.resolutionRules).length > 1024) throw new Error("Rules must contain 1–1024 bytes.");
  const questionHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(normalized.question)));
  const rulesHash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(`${normalized.resolutionSource}\n${normalized.resolutionRules}`)));
  return { ...normalized, questionHash, rulesHash };
}

export function hashHex(hash: Uint8Array): string {
  return Array.from(hash, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
