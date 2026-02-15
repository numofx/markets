"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { publicClient as basePublicClient } from "@/lib/baseClients";
import { publicClient as celoPublicClient } from "@/lib/celoClients";

function pickResult<T>(item: { status: "success" | "failure"; result?: T }, fallback: T) {
  return item.status === "success" ? (item.result as T) : fallback;
}

function resolvePublicClient(chainId: 8453 | 42_220) {
  if (chainId === 8453) {
    return basePublicClient;
  }
  return celoPublicClient;
}

export type BorrowWalletData = {
  borrowBalance: bigint | null;
  borrowDecimals: number;
  collateralAllowance: bigint | null;
  collateralBalance: bigint | null;
  collateralDecimals: number;
  fyBalance: bigint | null;
  fyDecimals: number;
  kesBalance: bigint | null;
  kesDecimals: number;
  lastError: string | null;
  usdtAllowance: bigint | null;
  usdtBalance: bigint | null;
  usdtDecimals: number;
};

type FetchBorrowWalletDataParams = {
  address: Address;
  chainId: 8453 | 42_220;
  tokens: { borrow: Address; collateral: Address; fy: Address };
  joins: { collateral: Address };
};

async function fetchBorrowWalletData(
  params: FetchBorrowWalletDataParams
): Promise<BorrowWalletData> {
  const client = resolvePublicClient(params.chainId);
  const [decimalsResults, balancesResults, allowanceResults] = await Promise.all([
    client.multicall({
      contracts: [
        { abi: erc20Abi, address: params.tokens.collateral, functionName: "decimals" },
        { abi: erc20Abi, address: params.tokens.fy, functionName: "decimals" },
        { abi: erc20Abi, address: params.tokens.borrow, functionName: "decimals" },
      ],
    }),
    client.multicall({
      contracts: [
        {
          abi: erc20Abi,
          address: params.tokens.collateral,
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
          address: params.tokens.borrow,
          args: [params.address],
          functionName: "balanceOf",
        },
      ],
    }),
    client.multicall({
      contracts: [
        {
          abi: erc20Abi,
          address: params.tokens.collateral,
          args: [params.address, params.joins.collateral],
          functionName: "allowance",
        },
      ],
    }),
  ]);

  const collateralDecimals = pickResult(decimalsResults[0], 18);
  const fyDecimals = pickResult(decimalsResults[1], 18);
  const borrowDecimals = pickResult(decimalsResults[2], 18);

  const collateralBalance = pickResult(balancesResults[0], null as bigint | null);
  const fyBalance = pickResult(balancesResults[1], null as bigint | null);
  const borrowBalance = pickResult(balancesResults[2], null as bigint | null);
  const collateralAllowance = pickResult(allowanceResults[0], null as bigint | null);

  return {
    borrowBalance,
    borrowDecimals,
    collateralAllowance,
    collateralBalance,
    collateralDecimals,
    fyBalance,
    fyDecimals,
    kesBalance: borrowBalance,
    kesDecimals: borrowDecimals,
    lastError: null,
    usdtAllowance: collateralAllowance,
    usdtBalance: collateralBalance,
    usdtDecimals: collateralDecimals,
  };
}

export function useBorrowWalletData(params: {
  userAddress?: Address;
  chainId?: 8453 | 42_220;
  fyToken: Address;
  borrowToken?: Address;
  kesToken?: Address;
  collateralToken?: Address;
  usdtToken?: Address;
  collateralJoin?: Address;
  usdtJoin?: Address;
}) {
  const [data, setData] = useState<BorrowWalletData>({
    borrowBalance: null,
    borrowDecimals: 18,
    collateralAllowance: null,
    collateralBalance: null,
    collateralDecimals: 6,
    fyBalance: null,
    fyDecimals: 18,
    kesBalance: null,
    kesDecimals: 18,
    lastError: null,
    usdtAllowance: null,
    usdtBalance: null,
    usdtDecimals: 6,
  });

  const chainId = params.chainId ?? 42_220;
  const collateralToken = (params.collateralToken ?? params.usdtToken) as Address;
  const collateralJoin = (params.collateralJoin ?? params.usdtJoin) as Address;
  const borrowToken = (params.borrowToken ?? params.kesToken) as Address;

  async function refetch(address: Address) {
    try {
      setData(
        await fetchBorrowWalletData({
          address,
          chainId,
          joins: { collateral: collateralJoin },
          tokens: {
            borrow: borrowToken,
            collateral: collateralToken,
            fy: params.fyToken,
          },
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
        borrowBalance: null,
        collateralAllowance: null,
        collateralBalance: null,
        fyBalance: null,
        kesBalance: null,
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
          chainId,
          joins: { collateral: collateralJoin },
          tokens: {
            borrow: borrowToken,
            collateral: collateralToken,
            fy: params.fyToken,
          },
        });
        if (cancelled) {
          return;
        }
        setData(next);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        const message =
          caught instanceof Error ? caught.message : "Failed to read wallet balances.";
        setData((prev) => ({ ...prev, lastError: message }));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [borrowToken, chainId, collateralJoin, collateralToken, params.fyToken, params.userAddress]);

  return { ...data, refetch };
}
