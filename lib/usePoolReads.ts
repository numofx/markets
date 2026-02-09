"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type UsePoolReadsResult = {
  loading: boolean;
  error: Error | null;
  baseToken: Address | null;
  fyToken: Address | null;
  poolBaseBalance: bigint | null;
  poolFyBalance: bigint | null;
  maturity: number | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseSymbol: string | null;
  fySymbol: string | null;
  userBaseBal?: bigint | null;
  userFyBal?: bigint | null;
  refetch: () => void;
};

type PoolSnapshot = {
  baseToken: Address;
  fyToken: Address;
  baseDecimals: bigint;
  maturity: number;
  baseBalance: bigint;
  fyBalance: bigint;
  baseSymbol: string;
  fySymbol: string;
  tokenDecimals: [number, number];
  userBaseBal?: bigint;
  userFyBal?: bigint;
};

async function readPoolSnapshot(userAddress?: Address): Promise<PoolSnapshot> {
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;

  const [baseToken, fyToken, baseDecimals, maturity, baseBalance, fyBalance] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { abi: poolAbi, address: poolAddress, functionName: "baseToken" },
        { abi: poolAbi, address: poolAddress, functionName: "fyToken" },
        { abi: poolAbi, address: poolAddress, functionName: "baseDecimals" },
        { abi: poolAbi, address: poolAddress, functionName: "maturity" },
        { abi: poolAbi, address: poolAddress, functionName: "getBaseBalance" },
        { abi: poolAbi, address: poolAddress, functionName: "getFYTokenBalance" },
      ],
    });

  const [baseSymbol, fySymbol, baseTokenDecimals, fyTokenDecimals] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "symbol" },
      { abi: erc20Abi, address: fyToken, functionName: "symbol" },
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
    ],
  });

  let userBaseBal: bigint | undefined;
  let userFyBal: bigint | undefined;
  if (userAddress) {
    const [baseBal, fyBal] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { abi: erc20Abi, address: baseToken, args: [userAddress], functionName: "balanceOf" },
        { abi: erc20Abi, address: fyToken, args: [userAddress], functionName: "balanceOf" },
      ],
    });
    userBaseBal = baseBal;
    userFyBal = fyBal;
  }

  return {
    baseBalance,
    baseDecimals,
    baseSymbol,
    baseToken,
    fyBalance,
    fySymbol,
    fyToken,
    maturity,
    tokenDecimals: [Number(baseTokenDecimals), Number(fyTokenDecimals)],
    userBaseBal,
    userFyBal,
  };
}

export function usePoolReads(userAddress?: Address): UsePoolReadsResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snapshot, setSnapshot] = useState<PoolSnapshot | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    // Refetch signal for this effect.
    void refreshIndex;

    setLoading(true);
    setError(null);

    void readPoolSnapshot(userAddress)
      .then((next) => {
        if (cancelled) {
          return;
        }
        setSnapshot(next);
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught : new Error("Failed to load pool data"));
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [refreshIndex, userAddress]);

  return {
    baseDecimals: snapshot ? Number(snapshot.baseDecimals) : null,
    baseSymbol: snapshot?.baseSymbol ?? null,
    baseToken: snapshot?.baseToken ?? null,
    error,
    fyDecimals: snapshot ? snapshot.tokenDecimals[1] : null,
    fySymbol: snapshot?.fySymbol ?? null,
    fyToken: snapshot?.fyToken ?? null,
    loading,
    maturity: snapshot?.maturity ?? null,
    poolBaseBalance: snapshot?.baseBalance ?? null,
    poolFyBalance: snapshot?.fyBalance ?? null,
    refetch: () => setRefreshIndex((value) => value + 1),
    userBaseBal: snapshot?.userBaseBal ?? null,
    userFyBal: snapshot?.userFyBal ?? null,
  };
}
