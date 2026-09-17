const MAX_TOKEN_AMOUNT = BigInt("18446744073709551615");

export function parseTokenAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError("Token decimals must be between 0 and 18.");
  }
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error("Enter a plain positive decimal amount.");
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) throw new Error(`Amount supports at most ${decimals} decimal places.`);
  const amount = BigInt(match[1]) * BigInt(10) ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (amount <= BigInt(0) || amount > MAX_TOKEN_AMOUNT) {
    throw new RangeError("Amount must be positive and fit in an unsigned 64-bit integer.");
  }
  return amount;
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || amount < BigInt(0) || amount > MAX_TOKEN_AMOUNT) {
    throw new RangeError("Invalid token amount or decimals.");
  }
  if (decimals === 0) return amount.toString();
  const digits = amount.toString().padStart(decimals + 1, "0");
  const fraction = digits.slice(-decimals).replace(/0+$/, "");
  return `${digits.slice(0, -decimals)}${fraction ? `.${fraction}` : ""}`;
}
