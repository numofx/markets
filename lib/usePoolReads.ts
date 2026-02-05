"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { publicClient } from "@/lib/celoClients";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type UsePoolReadsResult = {
  loading: boolean;
  error: Error | null;
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
        { address: poolAddress, abi: poolAbi, functionName: "baseToken" },
        { address: poolAddress, abi: poolAbi, functionName: "fyToken" },
        { address: poolAddress, abi: poolAbi, functionName: "baseDecimals" },
        { address: poolAddress, abi: poolAbi, functionName: "maturity" },
        { address: poolAddress, abi: poolAbi, functionName: "getBaseBalance" },
        { address: poolAddress, abi: poolAbi, functionName: "getFYTokenBalance" },
      ],
    });

  const [baseSymbol, fySymbol, baseTokenDecimals, fyTokenDecimals] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { address: baseToken, abi: erc20Abi, functionName: "symbol" },
      { address: fyToken, abi: erc20Abi, functionName: "symbol" },
      { address: baseToken, abi: erc20Abi, functionName: "decimals" },
      { address: fyToken, abi: erc20Abi, functionName: "decimals" },
    ],
  });

  let userBaseBal: bigint | undefined;
  let userFyBal: bigint | undefined;
  if (userAddress) {
    const [baseBal, fyBal] = await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: baseToken, abi: erc20Abi, functionName: "balanceOf", args: [userAddress] },
        { address: fyToken, abi: erc20Abi, functionName: "balanceOf", args: [userAddress] },
      ],
    });
    userBaseBal = baseBal;
    userFyBal = fyBal;
  }

  return {
    baseToken,
    fyToken,
    baseDecimals,
    maturity,
    baseBalance,
    fyBalance,
    baseSymbol,
    fySymbol,
    tokenDecimals: [Number(baseTokenDecimals), Number(fyTokenDecimals)],
    userBaseBal,
    userFyBal,
  };
}

export function usePoolReads(userAddress?: Address): UsePoolReadsResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [poolBaseBalance, setPoolBaseBalance] = useState<bigint | null>(null);
  const [poolFyBalance, setPoolFyBalance] = useState<bigint | null>(null);
  const [maturity, setMaturity] = useState<number | null>(null);
  const [baseDecimals, setBaseDecimals] = useState<number | null>(null);
  const [fyDecimals, setFyDecimals] = useState<number | null>(null);
  const [baseSymbol, setBaseSymbol] = useState<string | null>(null);
  const [fySymbol, setFySymbol] = useState<string | null>(null);
  const [userBaseBal, setUserBaseBal] = useState<bigint | null>(null);
  const [userFyBal, setUserFyBal] = useState<bigint | null>(null);
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const snapshot = await readPoolSnapshot(userAddress);
        if (cancelled) {
          return;
        }
        setPoolBaseBalance(snapshot.baseBalance);
        setPoolFyBalance(snapshot.fyBalance);
        setMaturity(snapshot.maturity);
        setBaseDecimals(Number(snapshot.baseDecimals));
        setFyDecimals(snapshot.tokenDecimals[1]);
        setBaseSymbol(snapshot.baseSymbol);
        setFySymbol(snapshot.fySymbol);
        setUserBaseBal(snapshot.userBaseBal ?? null);
        setUserFyBal(snapshot.userFyBal ?? null);
        setError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setError(caught instanceof Error ? caught : new Error("Failed to load pool data"));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [refreshIndex, userAddress]);

  return {
    loading,
    error,
    poolBaseBalance,
    poolFyBalance,
    maturity,
    baseDecimals,
    fyDecimals,
    baseSymbol,
    fySymbol,
    userBaseBal,
    userFyBal,
    refetch: () => setRefreshIndex((value) => value + 1),
  };
}
