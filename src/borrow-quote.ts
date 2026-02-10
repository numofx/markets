import type { Address } from "viem";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

const U128_MAX = BigInt("340282366920938463463374607431768211455");

function previewSellFyToken(fyIn: bigint) {
  return publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [fyIn],
    functionName: "sellFYTokenPreview",
  });
}

async function tryPreviewSellFyToken(fyIn: bigint) {
  try {
    return await previewSellFyToken(fyIn);
  } catch {
    return null;
  }
}

function readPoolBaseBalance() {
  return publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    functionName: "getBaseBalance",
  });
}

function readPoolFyBalance() {
  return publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    functionName: "getFYTokenBalance",
  });
}

export type BorrowQuote = {
  expectedKesOut: bigint;
  fyToBorrow: bigint;
};

function clampU128(value: bigint) {
  if (value < 0n) {
    return 0n;
  }
  return value > U128_MAX ? U128_MAX : value;
}

function estimateFyIn(desiredBaseOut: bigint, poolBaseBalance: bigint, poolFyBalance: bigint) {
  if (desiredBaseOut <= 0n || poolBaseBalance <= 0n || poolFyBalance <= 0n) {
    return null;
  }
  // Rough linear estimate using current reserves as price.
  return clampU128((desiredBaseOut * poolFyBalance) / poolBaseBalance);
}

async function findUpperBound(desiredKesOut: bigint, initialGuess: bigint) {
  let low = 0n;
  let high = clampU128(initialGuess <= 0n ? 1n : initialGuess);

  for (let i = 0; i < 32; i += 1) {
    const out = await tryPreviewSellFyToken(high);

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

async function findMinFyForKes(desiredKesOut: bigint, low: bigint, high: bigint) {
  let left = clampU128(low);
  let right = clampU128(high);

  for (let i = 0; i < 40; i += 1) {
    const mid = (left + right) / 2n;
    if (mid === left) {
      break;
    }
    const out = await tryPreviewSellFyToken(mid);
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
export async function quoteFyForKes(desiredKesOut: bigint): Promise<BorrowQuote> {
  if (desiredKesOut <= 0n) {
    return { expectedKesOut: 0n, fyToBorrow: 0n };
  }

  // If the user asks for more base out than the pool can possibly return, quotes will revert or never reach it.
  const [baseBalance, fyBalance] = await Promise.all([readPoolBaseBalance(), readPoolFyBalance()]);
  if (desiredKesOut >= baseBalance) {
    return { expectedKesOut: 0n, fyToBorrow: 0n };
  }

  const guess = estimateFyIn(desiredKesOut, baseBalance, fyBalance) ?? desiredKesOut;
  const bounds = await findUpperBound(desiredKesOut, guess);
  if (!bounds) {
    return { expectedKesOut: 0n, fyToBorrow: 0n };
  }

  const fyToBorrow = await findMinFyForKes(desiredKesOut, bounds.low, bounds.high);
  const expectedKesOut = await tryPreviewSellFyToken(fyToBorrow);
  if (expectedKesOut === null || expectedKesOut < desiredKesOut) {
    return { expectedKesOut: 0n, fyToBorrow: 0n };
  }
  return { expectedKesOut, fyToBorrow };
}
