"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { publicClient } from "@/lib/celoClients";

function pickResult<T>(item: { status: "success" | "failure"; result?: T }, fallback: T) {
  return item.status === "success" ? (item.result as T) : fallback;
}

export type BorrowWalletData = {
  kesBalance: bigint | null;
  kesDecimals: number;
  fyBalance: bigint | null;
  fyDecimals: number;
  lastError: string | null;
  usdtAllowance: bigint | null;
  usdtBalance: bigint | null;
  usdtDecimals: number;
};

async function fetchBorrowWalletData(params: {
  address: Address;
  tokens: { fy: Address; kes: Address; usdt: Address };
  joins: { usdt: Address };
}): Promise<BorrowWalletData> {
  const [decimalsResults, balancesResults, allowanceResults] = await Promise.all([
    publicClient.multicall({
      contracts: [
        { abi: erc20Abi, address: params.tokens.usdt, functionName: "decimals" },
        { abi: erc20Abi, address: params.tokens.fy, functionName: "decimals" },
        { abi: erc20Abi, address: params.tokens.kes, functionName: "decimals" },
      ],
    }),
    publicClient.multicall({
      contracts: [
        {
          abi: erc20Abi,
          address: params.tokens.usdt,
          args: [params.address],
          functionName: "balanceOf",
        },
        {
          abi: erc20Abi,
          address: params.tokens.fy,
          args: [params.address],
          functionName: "balanceOf",
        },
        {
          abi: erc20Abi,
          address: params.tokens.kes,
          args: [params.address],
          functionName: "balanceOf",
        },
      ],
    }),
    publicClient.multicall({
      contracts: [
        {
          abi: erc20Abi,
          address: params.tokens.usdt,
          args: [params.address, params.joins.usdt],
          functionName: "allowance",
        },
      ],
    }),
  ]);

  return {
    kesBalance: pickResult(balancesResults[2], null as bigint | null),
    kesDecimals: pickResult(decimalsResults[2], 18),
    fyBalance: pickResult(balancesResults[1], null as bigint | null),
    fyDecimals: pickResult(decimalsResults[1], 18),
    lastError: null,
    usdtAllowance: pickResult(allowanceResults[0], null as bigint | null),
    usdtBalance: pickResult(balancesResults[0], null as bigint | null),
    usdtDecimals: pickResult(decimalsResults[0], 6),
  };
}

export function useBorrowWalletData(params: {
  userAddress?: Address;
  fyToken: Address;
  kesToken: Address;
  usdtJoin: Address;
  usdtToken: Address;
}) {
  const [data, setData] = useState<BorrowWalletData>({
    kesBalance: null,
    kesDecimals: 18,
    fyBalance: null,
    fyDecimals: 18,
    lastError: null,
    usdtAllowance: null,
    usdtBalance: null,
    usdtDecimals: 6,
  });

  async function refetch(address: Address) {
    try {
      setData(
        await fetchBorrowWalletData({
          address,
          joins: { usdt: params.usdtJoin },
          tokens: { fy: params.fyToken, kes: params.kesToken, usdt: params.usdtToken },
        })
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Failed to read wallet balances.";
      setData((prev) => ({ ...prev, lastError: message }));
    }
  }

  useEffect(() => {
    if (!params.userAddress) {
      setData((prev) => ({
        ...prev,
        kesBalance: null,
        fyBalance: null,
        lastError: null,
        usdtAllowance: null,
        usdtBalance: null,
      }));
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchBorrowWalletData({
          address: params.userAddress as Address,
          joins: { usdt: params.usdtJoin },
          tokens: { fy: params.fyToken, kes: params.kesToken, usdt: params.usdtToken },
        });
        if (cancelled) {
          return;
        }
        setData(next);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        const message = caught instanceof Error ? caught.message : "Failed to read wallet balances.";
        setData((prev) => ({ ...prev, lastError: message }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.fyToken, params.kesToken, params.usdtJoin, params.usdtToken, params.userAddress]);

  return { ...data, refetch };
}
