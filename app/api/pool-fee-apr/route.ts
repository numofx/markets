import { NextResponse } from "next/server";
import type { Address } from "viem";
import { createPublicClient, http, keccak256, parseAbiItem, stringToHex } from "viem";
import { celo } from "viem/chains";
import { celoRegistryAbi } from "@/lib/abi/celoRegistry";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { sortedOraclesAbi } from "@/lib/abi/sortedOracles";
import { WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

const ONE_DAY_SECONDS = 86_400n;
const SECONDS_PER_YEAR = 31_536_000n;

const fallbackUrl = "https://forno.celo.org";
const envUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL;
const isPlaceholder =
  envUrl === "https://your_celo_rpc/" ||
  envUrl === "http://your_celo_rpc/" ||
  envUrl === "your_celo_rpc" ||
  envUrl === "YOUR_CELO_RPC";
const rpcUrl = !envUrl || isPlaceholder ? fallbackUrl : envUrl;

const client = createPublicClient({
  chain: celo,
  transport: http(rpcUrl),
});

const tradeEvent = parseAbiItem(
  "event Trade(uint32 maturity, address indexed from, address indexed to, int256 bases, int256 fyTokens)"
);

const CELO_REGISTRY_ADDRESS = "0x000000000000000000000000000000000000ce10" as const;
const SORTED_ORACLES_ID = keccak256(stringToHex("SortedOracles"));
const CUSD_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;

function toWad(value: bigint, decimals: number) {
  if (decimals === 18) {
    return value;
  }
  if (decimals < 18) {
    return value * 10n ** BigInt(18 - decimals);
  }
  return value / 10n ** BigInt(decimals - 18);
}

function clampFromBlock(current: bigint, lookback: bigint) {
  return current > lookback ? current - lookback : 0n;
}

function nullResponse(windowSeconds = ONE_DAY_SECONDS) {
  return NextResponse.json(
    { aprPercent: null, windowSeconds: Number(windowSeconds) },
    { status: 200 }
  );
}

async function findBlockAtOrAfterTimestamp(params: {
  latestBlock: bigint;
  targetTimestamp: bigint;
}) {
  const { latestBlock, targetTimestamp } = params;
  const LOOKBACK = 50_000n;
  let low = clampFromBlock(latestBlock, LOOKBACK);
  let high = latestBlock;

  while (low < high) {
    const mid = (low + high) / 2n;
    const block = await client.getBlock({ blockNumber: mid });
    if (block.timestamp < targetTimestamp) {
      low = mid + 1n;
    } else {
      high = mid;
    }
  }

  return low;
}

async function fetchKesmPerUsdWad(kesmAddress: Address) {
  const sortedOracles = (await client.readContract({
    abi: celoRegistryAbi,
    address: CELO_REGISTRY_ADDRESS,
    args: [SORTED_ORACLES_ID],
    functionName: "getAddressForOrDie",
  })) as Address;

  const [usdExpired, kesmExpired] = await client.multicall({
    allowFailure: false,
    contracts: [
      {
        abi: sortedOraclesAbi,
        address: sortedOracles,
        args: [CUSD_ADDRESS],
        functionName: "isOldestReportExpired",
      },
      {
        abi: sortedOraclesAbi,
        address: sortedOracles,
        args: [kesmAddress],
        functionName: "isOldestReportExpired",
      },
    ],
  });

  if (usdExpired[0] || kesmExpired[0]) {
    return null;
  }

  const [usdRate, usdDen, kesmRate, kesmDen] = await client
    .multicall({
      allowFailure: false,
      contracts: [
        {
          abi: sortedOraclesAbi,
          address: sortedOracles,
          args: [CUSD_ADDRESS],
          functionName: "medianRate",
        },
        {
          abi: sortedOraclesAbi,
          address: sortedOracles,
          args: [kesmAddress],
          functionName: "medianRate",
        },
      ],
    })
    .then(([usd, kesm]) => [usd[0], usd[1], kesm[0], kesm[1]]);

  if (usdRate <= 0n || kesmRate <= 0n) {
    return null;
  }

  // CELO per token = denominator / rate.
  const celoPerUsdWad = (usdDen * WAD) / usdRate;
  const celoPerKesmWad = (kesmDen * WAD) / kesmRate;
  if (celoPerUsdWad <= 0n || celoPerKesmWad <= 0n) {
    return null;
  }

  // KESm per USD = (CELO/USD) / (CELO/KESm)
  return (celoPerUsdWad * WAD) / celoPerKesmWad;
}

async function readPoolReservesAndFees(poolAddress: Address) {
  const [baseToken, fyToken, g1, g2, poolBaseBalance, poolFyBalance] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: poolAddress, functionName: "baseToken" },
      { abi: poolAbi, address: poolAddress, functionName: "fyToken" },
      { abi: poolAbi, address: poolAddress, functionName: "g1" },
      { abi: poolAbi, address: poolAddress, functionName: "g2" },
      { abi: poolAbi, address: poolAddress, functionName: "getBaseBalance" },
      { abi: poolAbi, address: poolAddress, functionName: "getFYTokenBalance" },
    ],
  });

  const [baseDecimals, fyDecimals] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
    ],
  });

  return {
    baseDecimals: Number(baseDecimals),
    baseToken,
    fyDecimals: Number(fyDecimals),
    fyToken,
    g1,
    g2,
    poolBaseBalance,
    poolFyBalance,
  };
}

function computeTvlUsdWad(params: {
  baseBalance: bigint;
  baseDecimals: number;
  fyBalance: bigint;
  fyDecimals: number;
  kesmPerUsdWad: bigint;
}) {
  const { baseBalance, baseDecimals, fyBalance, fyDecimals, kesmPerUsdWad } = params;

  const baseWad = toWad(baseBalance, baseDecimals);
  const fyWad = toWad(fyBalance, fyDecimals);
  const pWad = fyWad > 0n ? (baseWad * WAD) / fyWad : null; // base per FY

  const fyValueInBaseWad = pWad ? (fyWad * pWad) / WAD : 0n;
  const tvlBaseWad = baseWad + fyValueInBaseWad;
  const tvlUsdWad = (tvlBaseWad * WAD) / kesmPerUsdWad;

  return { pWad, tvlUsdWad };
}

function computeFeesBaseWadFromTrades(params: {
  baseDecimals: number;
  fyDecimals: number;
  g1: bigint;
  g2: bigint;
  logs: Array<{ args: { bases: bigint; fyTokens: bigint } }>;
  pWad: bigint | null;
}) {
  const { baseDecimals, fyDecimals, g1, g2, logs, pWad } = params;

  const Q64 = 2n ** 64n;
  const g1FeeMul = g1 < Q64 ? Q64 - g1 : 0n; // (1 - g1/Q64) scaled by Q64
  const g2Num = g2 > Q64 ? g2 - Q64 : 0n; // (1 - Q64/g2) * g2

  let feesBaseWad = 0n;
  for (const log of logs) {
    const { bases, fyTokens } = log.args;

    if (bases < 0n) {
      const baseInWad = toWad(-bases, baseDecimals);
      feesBaseWad += (baseInWad * g1FeeMul) / Q64;
      continue;
    }

    if (fyTokens < 0n) {
      const fyInWad = toWad(-fyTokens, fyDecimals);
      const feeFyWad = (fyInWad * g2Num) / g2;
      feesBaseWad += pWad ? (feeFyWad * pWad) / WAD : 0n;
    }
  }

  return feesBaseWad;
}

export async function GET() {
  try {
    const poolAddress = CELO_YIELD_POOL.poolAddress as Address;

    const { baseDecimals, baseToken, fyDecimals, g1, g2, poolBaseBalance, poolFyBalance } =
      await readPoolReservesAndFees(poolAddress);

    const kesmPerUsdWad = await fetchKesmPerUsdWad(baseToken);
    if (!kesmPerUsdWad || kesmPerUsdWad <= 0n) {
      return nullResponse();
    }

    const { pWad, tvlUsdWad } = computeTvlUsdWad({
      baseBalance: poolBaseBalance,
      baseDecimals,
      fyBalance: poolFyBalance,
      fyDecimals,
      kesmPerUsdWad,
    });

    if (tvlUsdWad <= 0n) {
      return nullResponse();
    }

    const latestBlock = await client.getBlockNumber();
    const latest = await client.getBlock({ blockNumber: latestBlock });
    const targetTs = latest.timestamp > ONE_DAY_SECONDS ? latest.timestamp - ONE_DAY_SECONDS : 0n;
    const fromBlock = await findBlockAtOrAfterTimestamp({
      latestBlock,
      targetTimestamp: targetTs,
    });

    const logs = await client.getLogs({
      address: poolAddress,
      event: tradeEvent,
      fromBlock,
      toBlock: latestBlock,
    });

    const feesBaseWad = computeFeesBaseWadFromTrades({
      baseDecimals,
      fyDecimals,
      g1: BigInt(g1),
      g2: BigInt(g2),
      logs: logs as Array<{ args: { bases: bigint; fyTokens: bigint } }>,
      pWad,
    });

    const feesUsdWad = (feesBaseWad * WAD) / kesmPerUsdWad;

    const windowSeconds =
      latest.timestamp > targetTs ? latest.timestamp - targetTs : ONE_DAY_SECONDS;
    const aprWad = (feesUsdWad * WAD * SECONDS_PER_YEAR) / (tvlUsdWad * windowSeconds);
    const aprPercent = Number(aprWad) / 1e16;
    const aprPercentSafe = Number.isFinite(aprPercent) ? aprPercent : null;

    return NextResponse.json(
      { aprPercent: aprPercentSafe, windowSeconds: Number(windowSeconds) },
      { headers: { "Cache-Control": "s-maxage=60, stale-while-revalidate=300" } }
    );
  } catch {
    return nullResponse();
  }
}
