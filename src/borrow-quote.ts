import type { Address } from "viem";
import { getRevertSelector } from "@/lib/get-revert-selector";
import { previewSellFyToken, readBorrowPoolStateForMarket } from "@/src/borrow-actions";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

const U128_MAX = BigInt("340282366920938463463374607431768211455");

type QuoteMarketParams = {
  chainId: 8453 | 42_220;
  poolAddress: Address;
};

const DEFAULT_MARKET = {
  chainId: 42_220,
  poolAddress: CELO_YIELD_POOL.poolAddress as Address,
} as const satisfies QuoteMarketParams;

function clampU128(value: bigint) {
  if (value < 0n) {
    return 0n;
  }
  return value > U128_MAX ? U128_MAX : value;
}

// Some pool previews revert for oversized inputs. Retry with progressively smaller sizes.
async function tryPreviewSellFyToken(fyIn: bigint, market: QuoteMarketParams) {
  let size = clampU128(fyIn);
  for (let i = 0; i < 6; i += 1) {
    if (size <= 0n) {
      return null;
    }
    try {
      return await previewSellFyToken({
        chainId: market.chainId,
        fyIn: size,
        poolAddress: market.poolAddress,
      });
    } catch {
      size /= 2n;
    }
  }
  return null;
}

export type BorrowQuote = {
  expectedKesOut: bigint;
  fyToBorrow: bigint;
  reason?:
    | "INSUFFICIENT_LIQUIDITY"
    | "CACHE_GT_LIVE"
    | "POOL_PENDING"
    | "NEGATIVE_INTEREST_RATES_NOT_ALLOWED"
    | "PREVIEW_REVERT"
    | "UNKNOWN";
  detail?: string;
};

function estimateFyIn(desiredBaseOut: bigint, poolBaseBalance: bigint, poolFyBalance: bigint) {
  if (desiredBaseOut <= 0n || poolBaseBalance <= 0n || poolFyBalance <= 0n) {
    return null;
  }
  // Rough linear estimate using current reserves as price.
  return clampU128((desiredBaseOut * poolFyBalance) / poolBaseBalance);
}

function isNegativeInterestRatesNotAllowed(caught: unknown) {
  const selector = getRevertSelector(caught);
  if (selector === "0xb24d9e1b") {
    return true;
  }
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  return message.includes("NegativeInterestRatesNotAllowed");
}

async function readPoolState(market: QuoteMarketParams) {
  const state = await readBorrowPoolStateForMarket({
    chainId: market.chainId,
    poolAddress: market.poolAddress,
  });
  return {
    baseBalance: state.baseLive,
    baseCached: state.baseCached,
    cachedGtLive: state.cachedGtLive,
    fyBalance: state.fyLive,
    fyTokenCached: state.fyCached,
    pendingBase: state.pendingBase,
    pendingFy: state.pendingFy,
  };
}

function quoteError(reason: BorrowQuote["reason"], detail: string): BorrowQuote {
  return { detail, expectedKesOut: 0n, fyToBorrow: 0n, reason };
}

async function findUpperBound(
  desiredKesOut: bigint,
  initialGuess: bigint,
  market: QuoteMarketParams
) {
  let low = 0n;
  let high = clampU128(initialGuess <= 0n ? 1n : initialGuess);

  for (let i = 0; i < 32; i += 1) {
    const out = await tryPreviewSellFyToken(high, market);

    // "Rate overflow" and similar math errors tend to happen for very large fyIn.
    // Treat reverts as "too high" and shrink.
    if (out === null) {
      high = clampU128(high / 2n);
      if (high <= low + 1n) {
        return null;
      }
      continue;
    }

    if (out >= desiredKesOut) {
      return { high, low };
    }

    low = high;
    if (high === U128_MAX) {
      return null;
    }
    high = clampU128(high * 2n);
  }

  return null;
}

async function findMinFyForKes(
  desiredKesOut: bigint,
  low: bigint,
  high: bigint,
  market: QuoteMarketParams
) {
  let left = clampU128(low);
  let right = clampU128(high);

  for (let i = 0; i < 40; i += 1) {
    const mid = (left + right) / 2n;
    if (mid === left) {
      break;
    }
    const out = await tryPreviewSellFyToken(mid, market);
    if (out === null) {
      right = mid;
      continue;
    }
    if (out >= desiredKesOut) {
      right = mid;
    } else {
      left = mid;
    }
  }

  return right;
}

// Finds the minimum fyIn such that sellFYTokenPreview(fyIn) >= desiredKesOut.
export async function quoteFyForKes(
  desiredKesOut: bigint,
  market: QuoteMarketParams = DEFAULT_MARKET
): Promise<BorrowQuote> {
  if (desiredKesOut <= 0n) {
    return quoteError("UNKNOWN", "Desired output must be > 0.");
  }

  // If the user asks for more base out than the pool can possibly return, quotes will revert or never reach it.
  const state = await readPoolState(market);
  if (state.cachedGtLive) {
    return quoteError(
      "CACHE_GT_LIVE",
      `Pool cache exceeds live balances. baseCached=${state.baseCached.toString()} baseLive=${state.baseBalance.toString()} fyCached=${state.fyTokenCached.toString()} fyLive=${state.fyBalance.toString()}.`
    );
  }
  if (state.pendingBase !== 0n || state.pendingFy !== 0n) {
    return quoteError(
      "POOL_PENDING",
      `Pool has pending (unprocessed) balances. basePending=${state.pendingBase.toString()} fyPending=${state.pendingFy.toString()}.`
    );
  }
  if (desiredKesOut >= state.baseBalance) {
    return quoteError(
      "INSUFFICIENT_LIQUIDITY",
      `Pool base balance is ${state.baseBalance.toString()} (raw units), desired is ${desiredKesOut.toString()}.`
    );
  }

  const guess = estimateFyIn(desiredKesOut, state.baseBalance, state.fyBalance) ?? desiredKesOut;
  const bounds = await findUpperBound(desiredKesOut, guess, market);
  if (!bounds) {
    return quoteError(
      "PREVIEW_REVERT",
      "Failed to find a non-reverting upper bound for sellFYTokenPreview."
    );
  }

  const fyToBorrow = await findMinFyForKes(desiredKesOut, bounds.low, bounds.high, market);
  let expectedKesOut: bigint;
  try {
    expectedKesOut = await previewSellFyToken({
      chainId: market.chainId,
      fyIn: fyToBorrow,
      poolAddress: market.poolAddress,
    });
  } catch (caught) {
    return quoteError(
      isNegativeInterestRatesNotAllowed(caught)
        ? "NEGATIVE_INTEREST_RATES_NOT_ALLOWED"
        : "PREVIEW_REVERT",
      isNegativeInterestRatesNotAllowed(caught)
        ? "Pool rejected preview: negative interest rates not allowed."
        : "sellFYTokenPreview reverted at final check."
    );
  }
  if (expectedKesOut < desiredKesOut) {
    return quoteError("UNKNOWN", "Preview output below desired.");
  }
  return { expectedKesOut, fyToBorrow };
}
