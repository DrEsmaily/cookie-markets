const assert = require("node:assert/strict");
const { test } = require("node:test");
const { quoteAmmBuy, maximumAmmTrade, creatorClaimable } = require("../.test-build/amm-pool.js");
const { PRICE_SCALE, quoteOrderFill, quotePoolSwap } = require("../.test-build/trading-math.js");
const max = 18_446_744_073_709_551_615n;
const order = { totalShares: 1000n, filledShares: 0n, fillShares: 1000n, price: 333333n, feeBps: 30 };
const pool = { reserveIn: 1000000n, reserveOut: 2000000n, amountIn: 10000n, feeBps: 30, slippageBps: 100 };

test("order partial fills charge the same aggregate collateral and fees as a full fill", () => {
  const whole = quoteOrderFill(order);
  let filledShares = 0n;
  let collateral = 0n;
  let fee = 0n;
  for (const fillShares of [100n, 200n, 300n, 400n]) {
    const fill = quoteOrderFill({ ...order, filledShares, fillShares });
    filledShares += fillShares;
    collateral += fill.collateral;
    fee += fill.fee;
    assert.equal(fill.buyerDebit, fill.collateral + fill.fee);
    assert.equal(fill.remainingShares, order.totalShares - filledShares);
  }
  assert.equal(collateral, whole.collateral);
  assert.equal(fee, whole.fee);
  assert.equal(whole.collateral, 334n);
  assert.equal(whole.fee, 2n);
});

test("order quotes reject overfills, free dust fills, invalid prices, and overflowing debits", () => {
  for (const change of [{ fillShares: 1001n }, { filledShares: 1001n }, { filledShares: -1n }, { fillShares: 0n }, { price: 0n }, { price: PRICE_SCALE + 1n }, { price: 0.5 }, { feeBps: -1 }, { feeBps: 1001 }, { feeBps: 0.5 }, { totalShares: max + 1n }]) {
    assert.throws(() => quoteOrderFill({ ...order, ...change }), RangeError);
  }
  assert.throws(() => quoteOrderFill({ ...order, filledShares: 1n, fillShares: 1n }), RangeError);
  assert.throws(() => quoteOrderFill({ ...order, totalShares: max, fillShares: max, price: PRICE_SCALE, feeBps: 1 }), RangeError);
  assert.equal(quoteOrderFill({ ...order, totalShares: max, fillShares: max, price: PRICE_SCALE, feeBps: 0 }).collateral, max);
});

test("pool swaps retain fees, never reduce the reserve product, and bind minimum output", () => {
  const quote = quotePoolSwap(pool);
  assert.equal(quote.amountOut, 19743n);
  assert.equal(quote.minimumOut, 19546n);
  assert.ok(quote.reserveInAfter * quote.reserveOutAfter >= pool.reserveIn * pool.reserveOut);
  assert.equal(quotePoolSwap({ ...pool, slippageBps: 0 }).minimumOut, quote.amountOut);
  assert.ok(quotePoolSwap({ ...pool, feeBps: 0 }).amountOut > quote.amountOut);
});

test("pool quotes reject absent liquidity, dust output, overflow, and unbounded slippage", () => {
  for (const change of [{ reserveIn: 0n }, { reserveOut: 0n }, { amountIn: 0n }, { reserveIn: max }, { feeBps: 1001 }, { slippageBps: 10000 }, { slippageBps: -1 }, { slippageBps: 0.1 }]) {
    assert.throws(() => quotePoolSwap({ ...pool, ...change }), RangeError);
  }
  assert.throws(() => quotePoolSwap({ ...pool, reserveOut: 1n, amountIn: 1n }), RangeError);
});

test("pool integer rounding preserves custody across a deterministic reserve grid", () => {
  for (const reserveIn of [1n, 100n, 10000n, max / 2n]) {
    for (const reserveOut of [100n, 10000n, max]) {
      for (const amountIn of [1n, 100n, 10000n]) {
        for (const feeBps of [0, 30, 1000]) {
          const weighted = amountIn * BigInt(10000 - feeBps);
          if (weighted * reserveOut / (reserveIn * 10000n + weighted) === 0n) continue;
          const quote = quotePoolSwap({ reserveIn, reserveOut, amountIn, feeBps, slippageBps: 100 });
          assert.ok(quote.amountOut < reserveOut);
          assert.ok(quote.minimumOut > 0n && quote.minimumOut <= quote.amountOut);
          assert.ok(quote.reserveInAfter * quote.reserveOutAfter >= reserveIn * reserveOut);
        }
      }
    }
  }
});

test("AMM client quote mirrors per-transaction cap, fee, slippage, and settlement", () => {
  const cap = maximumAmmTrade(1_000_000n);
  assert.equal(cap, 10_000n);
  const first = quoteAmmBuy("yes", cap, 1_000_000n, 1_000_000n, 1_000_000n);
  assert.equal(first.fee, 100n);
  assert.equal(first.minimumSharesOut, first.sharesOut * 99n / 100n);
  assert.throws(() => quoteAmmBuy("yes", cap + 1n, 1_000_000n, 1_000_000n, 1_000_000n));
  assert.doesNotThrow(() => quoteAmmBuy("yes", maximumAmmTrade(first.liquidityAfter), first.liquidityAfter, first.yesReserveAfter, first.noReserveAfter));
  assert.equal(creatorClaimable("yes", 400n, 900n), 400n);
  assert.equal(creatorClaimable("no", 400n, 900n), 900n);
  assert.equal(creatorClaimable("invalid", 400n, 900n), 650n);
});
