export const PRICE_SCALE = 1_000_000n;
const BASIS_POINTS = 10_000n;
const MAX_AMOUNT = 18_446_744_073_709_551_615n;

function amount(value: bigint, name: string, allowZero = false) {
  if (typeof value !== "bigint" || value < (allowZero ? 0n : 1n) || value > MAX_AMOUNT) {
    throw new RangeError(`${name} must fit an unsigned 64-bit integer${allowZero ? "" : " and be positive"}.`);
  }
}

function basisPoints(value: number, maximum: number, name: string): bigint {
  if (!Number.isInteger(value) || value < 0 || value > maximum) throw new RangeError(`Invalid ${name}.`);
  return BigInt(value);
}

function ceilDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}

export function quoteOrderFill(input: { totalShares: bigint; filledShares: bigint; fillShares: bigint; price: bigint; feeBps: number }) {
  const { totalShares, filledShares, fillShares, price } = input;
  amount(totalShares, "Order size");
  amount(filledShares, "Previously filled shares", true);
  amount(fillShares, "Fill size");
  if (typeof price !== "bigint" || price <= 0n || price > PRICE_SCALE) throw new RangeError("Price must be between one tick and one collateral unit per share.");
  if (filledShares + fillShares > totalShares) throw new RangeError("Fill exceeds remaining shares.");
  const feeRate = basisPoints(input.feeBps, 1000, "fee rate");
  const previouslyPaid = ceilDivide(filledShares * price, PRICE_SCALE);
  const totalPaid = ceilDivide((filledShares + fillShares) * price, PRICE_SCALE);
  const collateral = totalPaid - previouslyPaid;
  if (collateral === 0n) throw new RangeError("Fill is too small to transfer collateral; increase the fill size.");
  const fee = ceilDivide(totalPaid * feeRate, BASIS_POINTS) - ceilDivide(previouslyPaid * feeRate, BASIS_POINTS);
  const buyerDebit = collateral + fee;
  amount(buyerDebit, "Buyer debit");
  return { shares: fillShares, collateral, fee, buyerDebit, remainingShares: totalShares - filledShares - fillShares };
}

export function quotePoolSwap(input: { reserveIn: bigint; reserveOut: bigint; amountIn: bigint; feeBps: number; slippageBps: number }) {
  const { reserveIn, reserveOut, amountIn } = input;
  amount(reserveIn, "Input reserve");
  amount(reserveOut, "Output reserve");
  amount(amountIn, "Swap input");
  amount(reserveIn + amountIn, "Resulting input reserve");
  const feeRate = basisPoints(input.feeBps, 1000, "fee rate");
  const slippage = basisPoints(input.slippageBps, 9999, "slippage tolerance");
  const weightedInput = amountIn * (BASIS_POINTS - feeRate);
  const amountOut = weightedInput * reserveOut / (reserveIn * BASIS_POINTS + weightedInput);
  if (amountOut === 0n) throw new RangeError("Swap is too small to return any output.");
  const minimumOut = ceilDivide(amountOut * (BASIS_POINTS - slippage), BASIS_POINTS);
  return { amountIn, amountOut, minimumOut, reserveInAfter: reserveIn + amountIn, reserveOutAfter: reserveOut - amountOut };
}
