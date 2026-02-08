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

async function expandUpperBound(desiredKesOut: bigint) {
  let low = 0n;
  let high = clampU128(desiredKesOut);

  for (let i = 0; i < 24; i += 1) {
    try {
      const out = await previewSellFyToken(high);
      if (out >= desiredKesOut) {
        return { high, low };
      }
      low = high;
      if (high === U128_MAX) {
        return { high, low };
      }
      high = clampU128(high * 2n);
    } catch {
      return { high: U128_MAX, low };
    }
  }

  return { high, low };
}

async function findMinFyForKes(desiredKesOut: bigint, low: bigint, high: bigint) {
  let left = clampU128(low);
  let right = clampU128(high);

  for (let i = 0; i < 32; i += 1) {
    const mid = (left + right) / 2n;
    if (mid === left) {
      break;
    }
    try {
      const out = await previewSellFyToken(mid);
      if (out >= desiredKesOut) {
        right = mid;
      } else {
        left = mid;
      }
    } catch {
      right = mid;
    }
  }

  return right;
}

// Finds the minimum fyIn such that sellFYTokenPreview(fyIn) >= desiredKesOut.
export async function quoteFyForKes(desiredKesOut: bigint): Promise<BorrowQuote> {
  if (desiredKesOut <= 0n) {
    return { expectedKesOut: 0n, fyToBorrow: 0n };
  }

  const bounds = await expandUpperBound(desiredKesOut);
  const fyToBorrow = await findMinFyForKes(desiredKesOut, bounds.low, bounds.high);
  const expectedKesOut = await previewSellFyToken(fyToBorrow);
  return { expectedKesOut, fyToBorrow };
}
