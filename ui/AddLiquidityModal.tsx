"use client";

import { Settings, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Address } from "viem";
import { decodeEventLog, formatUnits, isAddress, parseUnits, zeroAddress } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { yieldPoolMintHelperAbi, yieldPoolMintHelperBytecode } from "@/lib/abi/yieldPoolMintHelper";
import { publicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
import { getRevertSelector } from "@/lib/get-revert-selector";
import type { MintErrorHint } from "@/lib/mint-revert";
import { decodeMintErrorHint, getRevertInfo } from "@/lib/mint-revert";
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { Button } from "@/ui/Button";

const MAX_UINT256 = 2n ** 256n - 1n;
const DEFAULT_RATIO_SLIPPAGE_BPS = 200n;
const WALLET_TIMEOUT_MS = 120_000;

type WalletClient = NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;
type NonceState = { next: number };

class MintFlowError extends Error {
  readonly hint: MintErrorHint;

  constructor(message: string, hint: MintErrorHint) {
    super(message);
    this.name = "MintFlowError";
    this.hint = hint;
  }
}

function takeNonce(state: NonceState) {
  const value = state.next;
  state.next += 1;
  return value;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function formatToken(balance: bigint | null, decimals: number | null, symbol: string | null) {
  if (balance === null || decimals === null || !symbol) {
    return "—";
  }
  return `${Number.parseFloat(formatUnits(balance, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  })} ${symbol}`;
}

function parseRatioSlippageBps(raw: string) {
  const parsed = Number.parseInt(raw || "0", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0n;
  }
  return BigInt(parsed);
}

function getButtonText(phase: Phase) {
  if (phase === "pending") {
    return "Adding liquidity…";
  }
  if (phase === "done") {
    return "Succeeded";
  }
  if (phase === "error") {
    return "Failed";
  }
  return "Add liquidity";
}

function assertReceiptSuccess(params: { status: unknown; context: string }) {
  if (params.status === "success") {
    return;
  }
  if (params.status === "reverted") {
    throw new Error(`${params.context} reverted.`);
  }
}

function formatUtcMaturityLabel(maturitySeconds: number) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(maturitySeconds * 1000));
}

function formatRatioWad(value: bigint) {
  return Number.parseFloat(formatUnits(value, 18)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

function formatTokenAmount(value: bigint, decimals: number) {
  return Number.parseFloat(formatUnits(value, decimals)).toLocaleString(undefined, {
    maximumFractionDigits: 6,
  });
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Centralized mapping keeps all mint error UX in one place.
function formatContractFailure(params: {
  caught: unknown;
  fallback: string;
  relaxRatioCheck: boolean;
  baseDecimals?: number;
  baseSymbol?: string;
  helperAddress?: Address | null;
  poolAddress?: Address | null;
}) {
  const { caught, fallback, relaxRatioCheck } = params;
  const revertInfo = getRevertInfo(caught, {
    helperAddress: params.helperAddress ?? null,
    poolAddress: params.poolAddress ?? null,
  });
  const selector = revertInfo.selector ?? getRevertSelector(caught);
  const hint = decodeMintErrorHint(caught, {
    helperAddress: params.helperAddress ?? null,
    poolAddress: params.poolAddress ?? null,
  });
  let sourceSuffix = "";
  if (revertInfo.contractAddress && revertInfo.decodedAgainst === "unknown") {
    sourceSuffix = ` (source: unknown @ ${revertInfo.contractAddress})`;
  } else if (revertInfo.contractAddress && revertInfo.decodedAgainst === "helper") {
    sourceSuffix = ` (source: helper @ ${revertInfo.contractAddress})`;
  }

  if (hint?.kind === "slippageDuringMint") {
    if (hint.newRatio === 0n && hint.minRatio === 0n && hint.maxRatio === 0n) {
      return `Pool rejected mint ratio bounds (revert ${hint.selector}). Click Auto, try smaller size, or enable "Relax ratio check".${sourceSuffix}`;
    }
    if (relaxRatioCheck) {
      return `Pool rejected mint ratio bounds (revert ${hint.selector}). new=${formatRatioWad(hint.newRatio)}, min=${formatRatioWad(hint.minRatio)}, max=${formatRatioWad(hint.maxRatio)}. Try smaller size or retry after pool updates.${sourceSuffix}`;
    }
    return `Pool rejected mint ratio bounds (revert ${hint.selector}). new=${formatRatioWad(hint.newRatio)}, min=${formatRatioWad(hint.minRatio)}, max=${formatRatioWad(hint.maxRatio)}. Click Auto or enable "Relax ratio check", then retry.${sourceSuffix}`;
  }

  if (hint?.kind === "notEnoughBase") {
    if (hint.baseAvailable === 0n && hint.baseNeeded === 0n) {
      return `Mint failed: NotEnoughBaseIn (revert ${hint.selector}). Increase base amount or reduce fy amount, then retry.${sourceSuffix}`;
    }
    if (params.baseDecimals !== undefined && params.baseSymbol) {
      const shortfall =
        hint.baseNeeded > hint.baseAvailable ? hint.baseNeeded - hint.baseAvailable : 0n;
      return `Mint failed: NotEnoughBaseIn (revert ${hint.selector}). Pool sees ${formatUnits(hint.baseAvailable, params.baseDecimals)} ${params.baseSymbol} available but needs ${formatUnits(hint.baseNeeded, params.baseDecimals)} ${params.baseSymbol} (shortfall ${formatUnits(shortfall, params.baseDecimals)}). Click "Fix ratio (set base = needed)".${sourceSuffix}`;
    }
    return `Mint failed: NotEnoughBaseIn (revert ${hint.selector}). Increase base amount or reduce fy amount, then retry.${sourceSuffix}`;
  }

  if (selector === "0x68744619" && revertInfo.decodedAgainst === "helper") {
    return `Mint failed (pool rejected input ratio). Reverted via helper: ${selector} (details unavailable). Increase base slightly (start +1%) or reduce fy, then retry.`;
  }

  if (selector === "0xd48b6b81" && revertInfo.decodedAgainst === "helper") {
    return `Mint reverted via helper (revert ${selector}). Underlying pool likely returned SlippageDuringMint, but args were not exposed by the helper call path. Click Auto, try smaller size, or enable "Relax ratio check".${sourceSuffix}`;
  }

  const maybeAny = caught as { shortMessage?: string; message?: string };
  let base = fallback;
  if (typeof maybeAny?.shortMessage === "string") {
    base = maybeAny.shortMessage;
  } else if (typeof maybeAny?.message === "string") {
    base = maybeAny.message;
  }
  return selector ? `${base} (revert ${selector})${sourceSuffix}` : `${base}${sourceSuffix}`;
}

function requireWalletContext(params: {
  userAddress: Address | undefined;
  walletClient: WalletClient | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseToken: Address | null;
  fyToken: Address | null;
}) {
  if (!(params.userAddress && params.walletClient)) {
    throw new Error("Connect a wallet to add liquidity.");
  }
  if (params.baseDecimals === null || params.fyDecimals === null) {
    throw new Error("Pool data not ready.");
  }
  if (!(params.baseToken && params.fyToken)) {
    throw new Error("Pool token addresses unavailable.");
  }

  return {
    baseDecimals: params.baseDecimals,
    baseToken: params.baseToken,
    fyDecimals: params.fyDecimals,
    fyToken: params.fyToken,
    userAddress: params.userAddress,
    walletClient: params.walletClient,
  };
}

function parseAmounts(params: {
  baseAmount: string;
  baseDecimals: number;
  fyAmount: string;
  fyDecimals: number;
}) {
  const baseParsed = params.baseAmount ? parseUnits(params.baseAmount, params.baseDecimals) : 0n;
  const fyParsed = params.fyAmount ? parseUnits(params.fyAmount, params.fyDecimals) : 0n;
  if (baseParsed <= 0n || fyParsed <= 0n) {
    throw new Error("Enter both amounts.");
  }
  return { baseParsed, fyParsed };
}

function requireSufficientBalances(params: {
  baseAmount: bigint;
  fyAmount: bigint;
  userBaseBal: bigint | null;
  userFyBal: bigint | null;
  baseDecimals: number;
  fyDecimals: number;
  baseSymbol: string;
  fySymbol: string;
}) {
  if (params.userBaseBal !== null && params.userBaseBal < params.baseAmount) {
    throw new Error(
      `Insufficient ${params.baseSymbol}. You have ${formatUnits(params.userBaseBal, params.baseDecimals)} ${params.baseSymbol}.`
    );
  }
  if (params.userFyBal !== null && params.userFyBal < params.fyAmount) {
    throw new Error(
      `Insufficient ${params.fySymbol}. You have ${formatUnits(params.userFyBal, params.fyDecimals)} ${params.fySymbol}.`
    );
  }
}

const HELPER_STORAGE_KEY = `yieldPoolMintHelper:${celo.id}`;

function readCachedHelperAddress() {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(HELPER_STORAGE_KEY);
  if (raw && isAddress(raw)) {
    return raw as Address;
  }
  return null;
}

function cacheHelperAddress(address: Address) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(HELPER_STORAGE_KEY, address);
}

async function getOrDeployMintHelper(params: {
  walletClient: WalletClient;
  userAddress: Address;
  nonceState: NonceState;
}) {
  const cached = readCachedHelperAddress();
  if (cached) {
    return cached;
  }

  type DeployContractParams = {
    abi: typeof yieldPoolMintHelperAbi;
    account: Address;
    bytecode: `0x${string}`;
    chain: typeof celo;
    args: readonly [];
    nonce?: number;
  };
  type DeployCapableWalletClient = WalletClient & {
    deployContract: (params: DeployContractParams) => Promise<`0x${string}`>;
  };

  const deployHash = await withTimeout(
    (params.walletClient as DeployCapableWalletClient).deployContract({
      abi: yieldPoolMintHelperAbi,
      account: params.userAddress,
      args: [],
      bytecode: yieldPoolMintHelperBytecode,
      chain: celo,
      nonce: takeNonce(params.nonceState),
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the deployment."
  );

  const receipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  assertReceiptSuccess({ context: "Helper deployment", status: receipt.status });
  const helperAddress = receipt.contractAddress;
  if (!helperAddress) {
    throw new Error(
      "Helper deployment succeeded, but the contract address was missing from the receipt."
    );
  }

  cacheHelperAddress(helperAddress);
  return helperAddress;
}

async function ensureAllowance(params: {
  walletClient: WalletClient;
  userAddress: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  nonceState: NonceState;
}) {
  const allowance = (await publicClient.readContract({
    abi: erc20Abi,
    address: params.token,
    args: [params.userAddress, params.spender],
    functionName: "allowance",
  })) as unknown as bigint;

  if (allowance >= params.amount) {
    return;
  }

  // Some tokens require setting allowance to 0 before changing it.
  if (allowance > 0n) {
    const resetHash = await withTimeout(
      params.walletClient.writeContract({
        abi: erc20Abi,
        account: params.userAddress,
        address: params.token,
        args: [params.spender, 0n],
        chain: celo,
        functionName: "approve",
        nonce: takeNonce(params.nonceState),
      }),
      WALLET_TIMEOUT_MS,
      "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
    );
    const receipt = await publicClient.waitForTransactionReceipt({ hash: resetHash });
    assertReceiptSuccess({ context: "Approve (reset allowance)", status: receipt.status });
  }

  const approveHash = await withTimeout(
    params.walletClient.writeContract({
      abi: erc20Abi,
      account: params.userAddress,
      address: params.token,
      args: [params.spender, params.amount],
      chain: celo,
      functionName: "approve",
      nonce: takeNonce(params.nonceState),
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  assertReceiptSuccess({ context: "Approve", status: receipt.status });
}

async function readPoolRatioWad(params: { poolAddress: Address }) {
  const snapshot = await readPoolCacheSnapshot({ poolAddress: params.poolAddress });
  const isPending =
    snapshot.baseBalance !== snapshot.baseCached || snapshot.fyBalance !== snapshot.fyCached;

  // Yield v2 pool cache holds fyToken reserves plus outstanding LP supply.
  // For mint ratio bounds and user quoting, use observable pool balances.
  // This matches how users provide liquidity and avoids overstating required base amounts.
  const baseForRatio = isPending ? snapshot.baseBalance : snapshot.baseCached;
  const fyForRatio = isPending ? snapshot.fyBalance : snapshot.fyCached;
  if (fyForRatio <= 0n) {
    return null;
  }

  return (baseForRatio * 10n ** 18n) / fyForRatio;
}

type PoolCacheSnapshot = {
  baseCached: bigint;
  fyCached: bigint;
  baseBalance: bigint;
  fyBalance: bigint;
};

type PendingDeltaSnapshot = {
  baseDelta: bigint;
  fyDelta: bigint;
};

async function readPoolCacheSnapshot(params: { poolAddress: Address }): Promise<PoolCacheSnapshot> {
  const [cacheRaw, baseBalanceRaw, fyBalanceRaw] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: params.poolAddress, functionName: "getCache" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getBaseBalance" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getFYTokenBalance" },
    ],
  });
  const cache = cacheRaw as unknown as readonly [bigint, bigint, number];

  return {
    baseBalance: baseBalanceRaw as unknown as bigint,
    baseCached: cache[0],
    fyBalance: fyBalanceRaw as unknown as bigint,
    fyCached: cache[1],
  };
}

async function readPendingDeltas(params: { poolAddress: Address }): Promise<PendingDeltaSnapshot> {
  const snapshot = await readPoolCacheSnapshot(params);
  return {
    baseDelta: snapshot.baseBalance - snapshot.baseCached,
    fyDelta: snapshot.fyBalance - snapshot.fyCached,
  };
}

function formatSignedDelta(value: bigint, decimals: number, symbol: string) {
  const absolute = value < 0n ? -value : value;
  const direction = value < 0n ? "-" : "+";
  return `${direction}${formatUnits(absolute, decimals)} ${symbol}`;
}

function formatPendingDeltaLabel(params: {
  deltas: PendingDeltaSnapshot;
  baseDecimals: number;
  fyDecimals: number;
  baseSymbol: string;
  fySymbol: string;
}) {
  return `${formatSignedDelta(params.deltas.baseDelta, params.baseDecimals, params.baseSymbol)}, ${formatSignedDelta(params.deltas.fyDelta, params.fyDecimals, params.fySymbol)}`;
}

type PoolSyncFunctionName = "retrieveBase" | "retrieveFYToken" | "sellBase" | "sellFYToken";

async function runPoolSyncAction(params: {
  functionName: PoolSyncFunctionName;
  poolAddress: Address;
  userAddress: Address;
  walletClient: WalletClient;
  nonceState: NonceState;
}) {
  const args =
    params.functionName === "sellBase" || params.functionName === "sellFYToken"
      ? ([params.userAddress, 0n] as const)
      : ([params.userAddress] as const);

  const hash = await withTimeout(
    params.walletClient.writeContract({
      abi: poolAbi,
      account: params.userAddress,
      address: params.poolAddress,
      args,
      chain: celo,
      functionName: params.functionName,
      nonce: takeNonce(params.nonceState),
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  assertReceiptSuccess({ context: `${params.functionName}`, status: receipt.status });

  return hash;
}

async function recoverOrSyncPool(params: {
  poolAddress: Address;
  userAddress: Address | undefined;
  walletClient: WalletClient | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseSymbol: string;
  fySymbol: string;
}) {
  if (!(params.userAddress && params.walletClient)) {
    throw new Error("Connect a wallet to recover pool state.");
  }
  if (params.baseDecimals === null || params.fyDecimals === null) {
    throw new Error("Pool data not ready.");
  }

  const deltas = await readPendingDeltas({ poolAddress: params.poolAddress });
  if (deltas.baseDelta === 0n && deltas.fyDelta === 0n) {
    return {
      summary: "Pool has no pending balances.",
      txHash: null,
    };
  }

  const nonceState: NonceState = {
    next: await publicClient.getTransactionCount({
      address: params.userAddress,
      blockTag: "pending",
    }),
  };

  const prefersFyRecovery = deltas.fyDelta > 0n;
  const primaryAction: PoolSyncFunctionName = prefersFyRecovery
    ? "retrieveFYToken"
    : "retrieveBase";
  const fallbackAction: PoolSyncFunctionName = prefersFyRecovery ? "sellFYToken" : "sellBase";

  try {
    const txHash = await runPoolSyncAction({
      functionName: primaryAction,
      nonceState,
      poolAddress: params.poolAddress,
      userAddress: params.userAddress,
      walletClient: params.walletClient,
    });
    return {
      summary: `Pool sync sent via ${primaryAction}.`,
      txHash,
    };
  } catch {
    const txHash = await runPoolSyncAction({
      functionName: fallbackAction,
      nonceState,
      poolAddress: params.poolAddress,
      userAddress: params.userAddress,
      walletClient: params.walletClient,
    });
    return {
      summary: `Pool sync sent via ${fallbackAction} fallback.`,
      txHash,
    };
  }
}

async function assertPoolMintableState(params: {
  poolAddress: Address;
  baseDecimals: number;
  fyDecimals: number;
  baseSymbol: string;
  fySymbol: string;
}) {
  const snapshot = await readPoolCacheSnapshot({ poolAddress: params.poolAddress });
  const baseDelta = snapshot.baseBalance - snapshot.baseCached;
  const fyDelta = snapshot.fyBalance - snapshot.fyCached;

  if (baseDelta === 0n && fyDelta === 0n) {
    return;
  }

  const baseDeltaAbs = baseDelta < 0n ? -baseDelta : baseDelta;
  const fyDeltaAbs = fyDelta < 0n ? -fyDelta : fyDelta;
  const baseDir = baseDelta >= 0n ? "+" : "-";
  const fyDir = fyDelta >= 0n ? "+" : "-";

  throw new Error(
    `Pool is mid-update (pending balances): ${baseDir}${formatUnits(baseDeltaAbs, params.baseDecimals)} ${params.baseSymbol}, ${fyDir}${formatUnits(fyDeltaAbs, params.fyDecimals)} ${params.fySymbol}. Minting is disabled for this pool state; wait for sync and retry.`
  );
}

async function readMintRatios(params: { poolAddress: Address; ratioSlippageBps: bigint }) {
  const ratioWad = await readPoolRatioWad({ poolAddress: params.poolAddress });
  if (ratioWad === null) {
    return { maxRatio: MAX_UINT256, minRatio: 0n };
  }

  const minRatio = (ratioWad * (10_000n - params.ratioSlippageBps)) / 10_000n;
  const maxRatio = (ratioWad * (10_000n + params.ratioSlippageBps)) / 10_000n;
  return { maxRatio, minRatio };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Combines multiple onchain log decoding paths to avoid false LP/refund attribution.
function decodeTransfers(params: {
  logs: readonly { address: Address; data: `0x${string}`; topics: readonly `0x${string}`[] }[];
  userAddress: Address;
  poolAddress: Address;
  helperAddress?: Address | null;
  baseToken: Address;
  fyToken: Address;
}) {
  let mintedLp = 0n;
  let baseSentFromUser = 0n;
  let baseReceivedByUser = 0n;
  let fySentFromUser = 0n;
  let fyReceivedByUser = 0n;
  let mintedFromLiquidity: bigint | null = null;

  const poolLower = params.poolAddress.toLowerCase();
  const userLower = params.userAddress.toLowerCase();
  const baseLower = params.baseToken.toLowerCase();
  const fyLower = params.fyToken.toLowerCase();
  const helperLower = params.helperAddress?.toLowerCase() ?? null;
  const scopedCounterparties = new Set<string>([poolLower]);
  if (helperLower && helperLower !== poolLower) {
    scopedCounterparties.add(helperLower);
  }

  for (const log of params.logs) {
    if (log.address.toLowerCase() === poolLower) {
      try {
        const topics = [...log.topics] as [] | [`0x${string}`, ...`0x${string}`[]];
        const decodedPoolLog = decodeEventLog({
          abi: poolAbi,
          data: log.data,
          topics,
        });

        if (decodedPoolLog.eventName === "Liquidity") {
          const to = (decodedPoolLog.args.to as Address).toLowerCase();
          const poolTokens = decodedPoolLog.args.poolTokens as bigint;
          if (to === userLower && poolTokens > 0n) {
            mintedFromLiquidity = (mintedFromLiquidity ?? 0n) + poolTokens;
          }
        }
      } catch {
        // Ignore non-pool events.
      }
    }

    try {
      const topics = [...log.topics] as [] | [`0x${string}`, ...`0x${string}`[]];
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics,
      });
      if (decoded.eventName !== "Transfer") {
        continue;
      }

      const from = (decoded.args.from as Address).toLowerCase();
      const to = (decoded.args.to as Address).toLowerCase();
      const value = decoded.args.value as bigint;

      if (log.address.toLowerCase() === poolLower && from === zeroAddress && to === userLower) {
        mintedLp += value;
      }

      if (log.address.toLowerCase() === baseLower) {
        if (from === userLower && scopedCounterparties.has(to)) {
          baseSentFromUser += value;
        }
        if (to === userLower && scopedCounterparties.has(from)) {
          baseReceivedByUser += value;
        }
      }

      if (log.address.toLowerCase() === fyLower) {
        if (from === userLower && scopedCounterparties.has(to)) {
          fySentFromUser += value;
        }
        if (to === userLower && scopedCounterparties.has(from)) {
          fyReceivedByUser += value;
        }
      }
    } catch {
      // Ignore non-ERC20 Transfer logs and any decoding mismatches.
    }
  }

  if (mintedFromLiquidity !== null) {
    mintedLp = mintedFromLiquidity;
  }

  const baseUsed =
    baseSentFromUser > baseReceivedByUser ? baseSentFromUser - baseReceivedByUser : 0n;
  const fyUsed = fySentFromUser > fyReceivedByUser ? fySentFromUser - fyReceivedByUser : 0n;
  const baseRefund =
    baseReceivedByUser > baseSentFromUser ? baseReceivedByUser - baseSentFromUser : 0n;
  const fyRefund = fyReceivedByUser > fySentFromUser ? fyReceivedByUser - fySentFromUser : 0n;

  const totalSentFromUser = baseSentFromUser + fySentFromUser;
  const amountsUnavailable = mintedLp > 0n && totalSentFromUser === 0n;

  return { amountsUnavailable, baseRefund, baseUsed, fyRefund, fyUsed, mintedLp };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Single flow keeps wallet tx ordering and guards coherent.
async function addLiquidityFlow(params: {
  baseAmount: string;
  fyAmount: string;
  ratioSlippageBps: string;
  relaxRatioCheck: boolean;
  userAddress: Address | undefined;
  walletClient: WalletClient | null;
  pool: ReturnType<typeof usePoolReads>;
  poolAddress: Address;
}) {
  const ctx = requireWalletContext({
    baseDecimals: params.pool.baseDecimals,
    baseToken: params.pool.baseToken,
    fyDecimals: params.pool.fyDecimals,
    fyToken: params.pool.fyToken,
    userAddress: params.userAddress,
    walletClient: params.walletClient,
  });

  const { baseParsed, fyParsed } = parseAmounts({
    baseAmount: params.baseAmount,
    baseDecimals: ctx.baseDecimals,
    fyAmount: params.fyAmount,
    fyDecimals: ctx.fyDecimals,
  });

  requireSufficientBalances({
    baseAmount: baseParsed,
    baseDecimals: ctx.baseDecimals,
    baseSymbol: params.pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
    fyAmount: fyParsed,
    fyDecimals: ctx.fyDecimals,
    fySymbol: params.pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol,
    userBaseBal: params.pool.userBaseBal ?? null,
    userFyBal: params.pool.userFyBal ?? null,
  });

  const ratioBps = parseRatioSlippageBps(params.ratioSlippageBps);
  const nonceState: NonceState = {
    next: await publicClient.getTransactionCount({
      address: ctx.userAddress,
      blockTag: "pending",
    }),
  };

  await assertPoolMintableState({
    baseDecimals: ctx.baseDecimals,
    baseSymbol: params.pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
    fyDecimals: ctx.fyDecimals,
    fySymbol: params.pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol,
    poolAddress: params.poolAddress,
  });

  const { maxRatio, minRatio } = params.relaxRatioCheck
    ? { maxRatio: MAX_UINT256, minRatio: 0n }
    : await readMintRatios({
        poolAddress: params.poolAddress,
        ratioSlippageBps: ratioBps,
      });

  const helperAddress = await getOrDeployMintHelper({
    nonceState,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  try {
    await publicClient.simulateContract({
      abi: yieldPoolMintHelperAbi,
      account: ctx.userAddress,
      address: helperAddress,
      args: [
        params.poolAddress,
        ctx.baseToken,
        ctx.fyToken,
        baseParsed,
        fyParsed,
        minRatio,
        maxRatio,
      ],
      functionName: "mintTwoSided",
    });
  } catch (caught) {
    const hint = decodeMintErrorHint(caught, {
      helperAddress,
      poolAddress: params.poolAddress,
    });
    throw new MintFlowError(
      formatContractFailure({
        baseDecimals: ctx.baseDecimals,
        baseSymbol: params.pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
        caught,
        fallback: "Failed to add liquidity.",
        helperAddress,
        poolAddress: params.poolAddress,
        relaxRatioCheck: params.relaxRatioCheck,
      }),
      hint
    );
  }

  if (process.env.NODE_ENV === "development") {
    const snapshot = await readPoolCacheSnapshot({ poolAddress: params.poolAddress });
    // Debug surface for mint failures.
    // eslint-disable-next-line no-console
    console.debug("[AddLiquidityModal] mint-attempt", {
      cachedBase: snapshot.baseCached.toString(),
      liveBase: snapshot.baseBalance.toString(),
      pendingBase: (snapshot.baseBalance - snapshot.baseCached).toString(),
      userBaseIn: baseParsed.toString(),
      userFYIn: fyParsed.toString(),
    });
  }

  await ensureAllowance({
    amount: baseParsed,
    nonceState,
    spender: helperAddress,
    token: ctx.baseToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });
  await ensureAllowance({
    amount: fyParsed,
    nonceState,
    spender: helperAddress,
    token: ctx.fyToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  let txHash: `0x${string}`;
  try {
    await publicClient.simulateContract({
      abi: yieldPoolMintHelperAbi,
      account: ctx.userAddress,
      address: helperAddress,
      args: [
        params.poolAddress,
        ctx.baseToken,
        ctx.fyToken,
        baseParsed,
        fyParsed,
        minRatio,
        maxRatio,
      ],
      functionName: "mintTwoSided",
    });

    // Re-check pending balances right before wallet confirmation for mint.
    // Pool state can change between simulation and send (e.g. during approvals/user delay).
    await assertPoolMintableState({
      baseDecimals: ctx.baseDecimals,
      baseSymbol: params.pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
      fyDecimals: ctx.fyDecimals,
      fySymbol: params.pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol,
      poolAddress: params.poolAddress,
    });

    txHash = await withTimeout(
      ctx.walletClient.writeContract({
        abi: yieldPoolMintHelperAbi,
        account: ctx.userAddress,
        address: helperAddress,
        args: [
          params.poolAddress,
          ctx.baseToken,
          ctx.fyToken,
          baseParsed,
          fyParsed,
          minRatio,
          maxRatio,
        ],
        chain: celo,
        functionName: "mintTwoSided",
        nonce: takeNonce(nonceState),
      }),
      WALLET_TIMEOUT_MS,
      "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
    );
  } catch (caught) {
    const hint = decodeMintErrorHint(caught, {
      helperAddress,
      poolAddress: params.poolAddress,
    });
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.debug("[AddLiquidityModal] mint-error", {
        hintKind: hint?.kind ?? null,
        selector:
          getRevertInfo(caught, { helperAddress, poolAddress: params.poolAddress }).selector ??
          getRevertSelector(caught),
      });
    }
    throw new MintFlowError(
      formatContractFailure({
        baseDecimals: ctx.baseDecimals,
        baseSymbol: params.pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
        caught,
        fallback: "Failed to add liquidity.",
        helperAddress,
        poolAddress: params.poolAddress,
        relaxRatioCheck: params.relaxRatioCheck,
      }),
      hint
    );
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  try {
    assertReceiptSuccess({ context: "Add liquidity", status: receipt.status });
  } catch {
    throw new Error(
      `Add liquidity reverted onchain (tx ${txHash}). Turn on "Relax ratio check" in settings and try Auto again.`
    );
  }

  const { amountsUnavailable, baseRefund, baseUsed, fyRefund, fyUsed, mintedLp } = decodeTransfers({
    baseToken: ctx.baseToken,
    fyToken: ctx.fyToken,
    helperAddress,
    logs: receipt.logs as unknown as readonly {
      address: Address;
      data: `0x${string}`;
      topics: readonly `0x${string}`[];
    }[],
    poolAddress: params.poolAddress,
    userAddress: ctx.userAddress,
  });

  return {
    amountsUnavailable,
    baseRefund,
    baseUsed,
    fyRefund,
    fyUsed,
    mintedLp,
    txHash,
  };
}

function scaleMintAmounts(params: {
  baseAmount: string;
  fyAmount: string;
  baseDecimals: number | null;
  fyDecimals: number | null;
  numerator: bigint;
  denominator: bigint;
}) {
  if (params.baseDecimals === null || params.fyDecimals === null) {
    return null;
  }
  try {
    const baseRaw = parseUnits(params.baseAmount, params.baseDecimals);
    const fyRaw = parseUnits(params.fyAmount, params.fyDecimals);
    const nextBaseRaw = (baseRaw * params.numerator) / params.denominator;
    const nextFyRaw = (fyRaw * params.numerator) / params.denominator;
    if (nextBaseRaw <= 0n || nextFyRaw <= 0n) {
      return null;
    }
    return {
      baseAmount: formatUnits(nextBaseRaw, params.baseDecimals),
      fyAmount: formatUnits(nextFyRaw, params.fyDecimals),
    };
  } catch {
    return null;
  }
}

async function retryScaledMintAttempts(params: {
  baseAmount: string;
  fyAmount: string;
  ratioSlippageBps: string;
  userAddress: Address | undefined;
  walletClient: WalletClient | null;
  pool: ReturnType<typeof usePoolReads>;
  poolAddress: Address;
}) {
  const candidates = [
    { denominator: 2n, label: "50%", numerator: 1n },
    { denominator: 4n, label: "25%", numerator: 1n },
    { denominator: 10n, label: "10%", numerator: 1n },
  ] as const;

  let lastError: unknown = null;
  for (const candidate of candidates) {
    const scaled = scaleMintAmounts({
      baseAmount: params.baseAmount,
      baseDecimals: params.pool.baseDecimals,
      denominator: candidate.denominator,
      fyAmount: params.fyAmount,
      fyDecimals: params.pool.fyDecimals,
      numerator: candidate.numerator,
    });
    if (!scaled) {
      continue;
    }

    try {
      const retry = await addLiquidityFlow({
        ...params,
        baseAmount: scaled.baseAmount,
        fyAmount: scaled.fyAmount,
        relaxRatioCheck: true,
      });
      return {
        result: retry,
        retried: true,
        retryNote: `Retried with ${candidate.label} size + relaxed ratio bounds.`,
      };
    } catch (retryCaught) {
      lastError = retryCaught;
    }
  }

  throw lastError ?? new Error("Retry failed.");
}

async function addLiquidityFlowWithRetry(params: {
  baseAmount: string;
  fyAmount: string;
  ratioSlippageBps: string;
  relaxRatioCheck: boolean;
  userAddress: Address | undefined;
  walletClient: WalletClient | null;
  pool: ReturnType<typeof usePoolReads>;
  poolAddress: Address;
}) {
  try {
    const first = await addLiquidityFlow(params);
    if (first.mintedLp === 0n && !params.relaxRatioCheck) {
      const retry = await addLiquidityFlow({ ...params, relaxRatioCheck: true });
      return { result: retry, retried: true, retryNote: "Retried with relaxed ratio bounds." };
    }
    return { result: first, retried: false, retryNote: null };
  } catch (caught) {
    const selector =
      getRevertInfo(caught, { poolAddress: params.poolAddress }).selector ??
      getRevertSelector(caught);
    if (selector === "0xd48b6b81" && !params.relaxRatioCheck) {
      const retry = await addLiquidityFlow({ ...params, relaxRatioCheck: true });
      return { result: retry, retried: true, retryNote: "Retried with relaxed ratio bounds." };
    }
    if (selector === "0x68744619") {
      return retryScaledMintAttempts(params);
    }
    throw caught;
  }
}

type AddLiquidityModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeText: string;
};

type Phase = "idle" | "pending" | "done" | "error";

function TxHashLine(props: { label: string; hash: `0x${string}` | null }) {
  if (!props.hash) {
    return null;
  }
  return (
    <p className="mt-1 break-all text-numo-muted text-xs">
      {props.label}: {props.hash}
    </p>
  );
}

function SettingsPanel(props: {
  open: boolean;
  ratioSlippageBps: string;
  onChangeRatioSlippageBps: (value: string) => void;
  relaxRatioCheck: boolean;
  onChangeRelaxRatioCheck: (value: boolean) => void;
}) {
  if (!props.open) {
    return null;
  }
  return (
    <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3">
      <label className="flex flex-col gap-2">
        <span className="text-numo-muted text-xs">Ratio slippage (bps)</span>
        <input
          className="w-full rounded-xl border border-numo-border bg-white px-3 py-2 text-numo-ink text-sm outline-none focus:border-numo-ink/30"
          inputMode="numeric"
          onChange={(e) => props.onChangeRatioSlippageBps(e.target.value)}
          value={props.ratioSlippageBps}
        />
      </label>
      <p className="mt-2 text-numo-muted text-xs">
        Safety bounds for the pool’s cached base/fy ratio when minting.
      </p>

      <label className="mt-4 flex items-center justify-between gap-3">
        <span className="text-numo-muted text-xs">Relax ratio check</span>
        <input
          checked={props.relaxRatioCheck}
          className="h-4 w-4 accent-numo-ink"
          onChange={(e) => props.onChangeRelaxRatioCheck(e.target.checked)}
          type="checkbox"
        />
      </label>
      <p className="mt-2 text-numo-muted text-xs">
        Unsafe: skips min/max ratio bounds. Still blocks if the pool has pending balances.
      </p>
    </div>
  );
}

function TokenAmountCard(props: {
  value: string;
  onChangeValue: (value: string) => void;
  symbol: string;
  balanceText: string;
  actionText?: string;
  onAction?: () => void;
}) {
  const showAction = Boolean(props.actionText) && Boolean(props.onAction);
  return (
    <div className="rounded-3xl bg-numo-pill p-5">
      <div className="flex items-start justify-between gap-4">
        <input
          className="w-full bg-transparent text-5xl text-numo-ink placeholder:text-numo-muted/40 focus:outline-none"
          inputMode="decimal"
          onChange={(e) => props.onChangeValue(e.target.value)}
          placeholder="0"
          value={props.value}
        />
        <div className="flex flex-col items-end">
          <div className="flex items-center gap-2">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white">
              <Image
                alt={props.symbol}
                height={36}
                src="/assets/KESm (Mento Kenyan Shilling).svg"
                width={36}
              />
            </span>
            <span className="font-semibold text-2xl text-numo-ink">{props.symbol}</span>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <span className="text-numo-muted text-sm">{props.balanceText}</span>
            {showAction ? (
              <button
                className="rounded-full border border-numo-border bg-white px-2.5 py-1 text-[11px] text-numo-muted hover:text-numo-ink"
                onClick={() => props.onAction?.()}
                type="button"
              >
                {props.actionText}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function MintOutcomeCard(props: {
  amountsUnavailable: boolean;
  phase: Phase;
  mintedLp: bigint | null;
  baseUsed: bigint | null;
  fyUsed: bigint | null;
  baseRefund: bigint | null;
  fyRefund: bigint | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseSymbol: string;
  fySymbol: string;
}) {
  if (props.phase !== "done") {
    return null;
  }

  let mintedText = "—";
  if (props.mintedLp !== null) {
    mintedText = props.mintedLp.toLocaleString();
  }

  const baseUsedText =
    props.amountsUnavailable || props.baseUsed === null || props.baseDecimals === null
      ? "—"
      : `${formatUnits(props.baseUsed, props.baseDecimals)} ${props.baseSymbol}`;
  const fyUsedText =
    props.amountsUnavailable || props.fyUsed === null || props.fyDecimals === null
      ? "—"
      : `${formatUnits(props.fyUsed, props.fyDecimals)} ${props.fySymbol}`;

  const showBaseRefund =
    props.baseRefund !== null && props.baseRefund > 0n && props.baseDecimals !== null;
  const showFyRefund = props.fyRefund !== null && props.fyRefund > 0n && props.fyDecimals !== null;

  return (
    <div className="mt-4 rounded-2xl border border-numo-border bg-white px-5 py-4">
      <div className="flex items-center justify-between text-numo-muted text-sm">
        <span>LP minted</span>
        <span className="font-medium text-numo-ink">{mintedText}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-numo-muted text-sm">
        <span>{props.baseSymbol} used</span>
        <span className="font-medium text-numo-ink">{baseUsedText}</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-numo-muted text-sm">
        <span>{props.fySymbol} used</span>
        <span className="font-medium text-numo-ink">{fyUsedText}</span>
      </div>

      {showBaseRefund ? (
        <div className="mt-4 flex items-center justify-between text-numo-muted text-sm">
          <span>{props.baseSymbol} refunded</span>
          <span className="font-medium text-numo-ink">
            {formatUnits(props.baseRefund as bigint, props.baseDecimals as number)}{" "}
            {props.baseSymbol}
          </span>
        </div>
      ) : null}

      {showFyRefund ? (
        <div className="mt-2 flex items-center justify-between text-numo-muted text-sm">
          <span>{props.fySymbol} refunded</span>
          <span className="font-medium text-numo-ink">
            {formatUnits(props.fyRefund as bigint, props.fyDecimals as number)} {props.fySymbol}
          </span>
        </div>
      ) : null}

      {props.mintedLp === 0n ? (
        <p className="mt-3 text-numo-muted text-xs">
          No LP shares were minted. If one side was missing or the ratio was off, the pool may
          refund your tokens to your wallet.
        </p>
      ) : null}
      {props.amountsUnavailable ? (
        <p className="mt-3 text-numo-muted text-xs">
          Amounts unavailable (route didn&apos;t pass through helper/pool directly).
        </p>
      ) : null}
    </div>
  );
}

function AddLiquidityModalView(props: {
  feeText: string;
  poolName: string;
  isPending: boolean;
  canSubmit: boolean;
  buttonText: string;
  close: () => void;
  submit: () => void;
  showSettings: boolean;
  onToggleSettings: () => void;
  ratioSlippageBps: string;
  onChangeRatioSlippageBps: (value: string) => void;
  relaxRatioCheck: boolean;
  onChangeRelaxRatioCheck: (value: boolean) => void;
  fyAmount: string;
  onChangeFyAmount: (value: string) => void;
  baseAmount: string;
  onChangeBaseAmount: (value: string) => void;
  onAutoBase: () => void;
  fyBalanceText: string;
  baseBalanceText: string;
  fyPositionText: string;
  basePositionText: string;
  txHash: `0x${string}` | null;
  isMatured: boolean;
  maturityLabel: string | null;
  phase: Phase;
  error: string | null;
  quoteError: string | null;
  pendingStatusText: string | null;
  canSyncPool: boolean;
  syncPoolButtonText: string;
  onSyncPool: () => void;
  syncTxHash: `0x${string}` | null;
  amountsUnavailable: boolean;
  canApplyRatioFix: boolean;
  onApplyRatioFix: () => void;
  canApplyFyLimitFix: boolean;
  onApplyFyLimitFix: () => void;
  mintedLp: bigint | null;
  baseRefund: bigint | null;
  fyRefund: bigint | null;
  baseUsed: bigint | null;
  fyUsed: bigint | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={() => props.close()}
        type="button"
      />
      <div className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <button
            aria-label="Close"
            className="rounded-full p-2 text-numo-muted hover:bg-black/5 hover:text-numo-ink"
            disabled={props.isPending}
            onClick={() => props.close()}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>
          <h2 className="font-semibold text-lg text-numo-ink">Add liquidity</h2>
          <button
            aria-label="Settings"
            className="rounded-full p-2 text-numo-muted hover:bg-black/5 hover:text-numo-ink"
            onClick={() => props.onToggleSettings()}
            type="button"
          >
            <Settings className="h-6 w-6" />
          </button>
        </div>

        <div className="px-6 pb-6">
          <div className="flex items-center gap-4">
            <div className="-space-x-3 flex">
              <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-numo-accent/10">
                <Image
                  alt={CELO_YIELD_POOL.fyToken.symbol}
                  className="h-full w-full object-cover"
                  height={48}
                  src="/assets/KESm (Mento Kenyan Shilling).svg"
                  width={48}
                />
              </span>
              <span className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-numo-ink/10">
                <Image
                  alt={CELO_YIELD_POOL.baseToken.symbol}
                  className="h-full w-full object-cover"
                  height={48}
                  src="/assets/KESm (Mento Kenyan Shilling).svg"
                  width={48}
                />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <p className="truncate font-semibold text-numo-ink text-xl">{props.poolName}</p>
                <span className="rounded-xl border border-numo-border bg-white px-3 py-1 text-numo-muted text-xs">
                  {props.feeText}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    props.isMatured ? "bg-amber-500" : "bg-emerald-500"
                  )}
                />
                <span className={cn(props.isMatured ? "text-amber-700" : "text-emerald-600")}>
                  {props.isMatured
                    ? `Matured${props.maturityLabel ? ` (${props.maturityLabel} UTC)` : ""}`
                    : "In range"}
                </span>
              </div>
            </div>
          </div>

          <SettingsPanel
            onChangeRatioSlippageBps={props.onChangeRatioSlippageBps}
            onChangeRelaxRatioCheck={props.onChangeRelaxRatioCheck}
            open={props.showSettings}
            ratioSlippageBps={props.ratioSlippageBps}
            relaxRatioCheck={props.relaxRatioCheck}
          />

          <div className="mt-6 space-y-4">
            <TokenAmountCard
              balanceText={props.fyBalanceText}
              onChangeValue={props.onChangeFyAmount}
              symbol={CELO_YIELD_POOL.fyToken.symbol}
              value={props.fyAmount}
            />
            <TokenAmountCard
              actionText="Auto"
              balanceText={props.baseBalanceText}
              onAction={props.onAutoBase}
              onChangeValue={props.onChangeBaseAmount}
              symbol={CELO_YIELD_POOL.baseToken.symbol}
              value={props.baseAmount}
            />
          </div>

          <div className="mt-6 rounded-2xl border border-numo-border bg-white px-5 py-4">
            <div className="flex items-center justify-between text-numo-muted text-sm">
              <span>{CELO_YIELD_POOL.fyToken.symbol} position</span>
              <span className="font-medium text-numo-ink">{props.fyPositionText}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-numo-muted text-sm">
              <span>{CELO_YIELD_POOL.baseToken.symbol} position</span>
              <span className="font-medium text-numo-ink">{props.basePositionText}</span>
            </div>
          </div>

          <TxHashLine hash={props.txHash} label="Transaction" />
          <TxHashLine hash={props.syncTxHash} label="Pool sync tx" />

          <MintOutcomeCard
            amountsUnavailable={props.amountsUnavailable}
            baseDecimals={props.baseDecimals}
            baseRefund={props.baseRefund}
            baseSymbol={CELO_YIELD_POOL.baseToken.symbol}
            baseUsed={props.baseUsed}
            fyDecimals={props.fyDecimals}
            fyRefund={props.fyRefund}
            fySymbol={CELO_YIELD_POOL.fyToken.symbol}
            fyUsed={props.fyUsed}
            mintedLp={props.mintedLp}
            phase={props.phase}
          />

          {props.quoteError ? (
            <p className="mt-4 text-numo-muted text-sm">{props.quoteError}</p>
          ) : null}

          {props.pendingStatusText ? (
            <p className="mt-4 text-numo-muted text-sm">{props.pendingStatusText}</p>
          ) : null}

          {props.phase === "error" ? (
            <p className="mt-4 text-red-700 text-sm">{props.error ?? "Transaction failed."}</p>
          ) : null}

          {props.canApplyRatioFix ? (
            <div className="mt-4">
              <Button
                className="w-full justify-center text-sm"
                onClick={() => void props.onApplyRatioFix()}
                size="lg"
                type="button"
                variant="ghost"
              >
                Fix ratio (set base = needed)
              </Button>
            </div>
          ) : null}

          {props.canApplyFyLimitFix ? (
            <div className="mt-3">
              <Button
                className="w-full justify-center text-sm"
                onClick={() => void props.onApplyFyLimitFix()}
                size="lg"
                type="button"
                variant="ghost"
              >
                Fit base to max fy
              </Button>
            </div>
          ) : null}

          <div className="mt-4">
            <Button
              className={cn(
                "w-full justify-center text-sm",
                props.canSyncPool ? null : "opacity-60"
              )}
              disabled={!props.canSyncPool}
              onClick={() => void props.onSyncPool()}
              size="lg"
              type="button"
              variant="ghost"
            >
              {props.syncPoolButtonText}
            </Button>
          </div>

          <div className="mt-6">
            <Button
              className={cn(
                "w-full justify-center text-base",
                props.canSubmit ? null : "opacity-60"
              )}
              disabled={!props.canSubmit}
              onClick={() => void props.submit()}
              size="lg"
              type="button"
              variant="secondary"
            >
              {props.buttonText}
            </Button>
          </div>

          <p className="mt-3 text-center text-numo-muted text-xs">
            Tokens are transferred to the pool, then minted into LP shares. Any unused amounts are
            refunded.
          </p>
        </div>
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Modal coordinates async wallet, pool, and UI state transitions.
export function AddLiquidityModal({ open, onOpenChange, feeText }: AddLiquidityModalProps) {
  const [mounted, setMounted] = useState(false);
  const userAddress = usePrivyAddress();
  const { walletClient } = usePrivyWalletClient();
  const pool = usePoolReads(userAddress);

  const [baseAmount, setBaseAmount] = useState("");
  const [fyAmount, setFyAmount] = useState("");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [ratioSlippageBps, setRatioSlippageBps] = useState(`${DEFAULT_RATIO_SLIPPAGE_BPS}`);
  const [relaxRatioCheck, setRelaxRatioCheck] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [mintErrorHint, setMintErrorHint] = useState<MintErrorHint>(null);
  const [fyLimitingAfterFix, setFyLimitingAfterFix] = useState(false);
  const [isSyncingPool, setIsSyncingPool] = useState(false);
  const [syncTxHash, setSyncTxHash] = useState<`0x${string}` | null>(null);
  const [pendingDeltas, setPendingDeltas] = useState<PendingDeltaSnapshot | null>(null);

  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [mintedLp, setMintedLp] = useState<bigint | null>(null);
  const [baseRefund, setBaseRefund] = useState<bigint | null>(null);
  const [fyRefund, setFyRefund] = useState<bigint | null>(null);
  const [baseUsed, setBaseUsed] = useState<bigint | null>(null);
  const [fyUsed, setFyUsed] = useState<bigint | null>(null);
  const [amountsUnavailable, setAmountsUnavailable] = useState(false);

  const poolName = `${CELO_YIELD_POOL.fyToken.symbol} / ${CELO_YIELD_POOL.baseToken.symbol}`;
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const isMatured = typeof pool.maturity === "number" && pool.maturity <= nowSeconds;
  const maturityLabel =
    typeof pool.maturity === "number" ? formatUtcMaturityLabel(pool.maturity) : null;
  const hasPendingPoolDeltas =
    (pendingDeltas?.baseDelta ?? 0n) !== 0n || (pendingDeltas?.fyDelta ?? 0n) !== 0n;
  const pendingStatusText =
    pendingDeltas && pool.baseDecimals !== null && pool.fyDecimals !== null
      ? `Pool pending deltas: ${formatPendingDeltaLabel({
          baseDecimals: pool.baseDecimals,
          baseSymbol: pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
          deltas: pendingDeltas,
          fyDecimals: pool.fyDecimals,
          fySymbol: pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol,
        })}`
      : null;

  const computeBaseQuote = async () => {
    setQuoteError(null);

    if (pool.baseDecimals === null || pool.fyDecimals === null) {
      setQuoteError("Pool data not ready.");
      return;
    }

    try {
      const fyParsed = fyAmount ? parseUnits(fyAmount, pool.fyDecimals) : 0n;
      if (fyParsed <= 0n) {
        setQuoteError("Enter a fyKESm amount first.");
        return;
      }

      const ratioWad = await readPoolRatioWad({ poolAddress });
      if (ratioWad === null) {
        setQuoteError("Pool ratio unavailable.");
        return;
      }

      const baseParsed = (fyParsed * ratioWad) / 10n ** 18n;
      setBaseAmount(formatUnits(baseParsed, pool.baseDecimals));
    } catch (caught) {
      setQuoteError(caught instanceof Error ? caught.message : "Failed to compute pool ratio.");
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && phase !== "pending") {
        onOpenChange(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange, phase]);

  useEffect(() => {
    if (!open) {
      return;
    }

    setPhase("idle");
    setError(null);
    setMintErrorHint(null);
    setFyLimitingAfterFix(false);
    setQuoteError(null);
    setRelaxRatioCheck(false);
    setTxHash(null);
    setSyncTxHash(null);
    setIsSyncingPool(false);
    setMintedLp(null);
    setBaseRefund(null);
    setFyRefund(null);
    setBaseUsed(null);
    setFyUsed(null);
    setAmountsUnavailable(false);

    // Balances can change outside this modal (swaps, mints, faucets, etc).
    // Refetch immediately on open so the "position" rows reflect current onchain state.
    pool.refetch();
    void readPendingDeltas({ poolAddress })
      .then((next) => setPendingDeltas(next))
      .catch(() => {
        // Keep stale values if RPC read fails temporarily.
      });
  }, [open, pool.refetch, poolAddress]);

  useEffect(() => {
    if (!open) {
      return;
    }
    if (isMatured) {
      setQuoteError(
        `Pool matured${maturityLabel ? ` on ${maturityLabel} UTC` : ""}. New liquidity cannot be added to this series.`
      );
    }
  }, [isMatured, maturityLabel, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const id = window.setInterval(() => {
      pool.refetch();
      void readPendingDeltas({ poolAddress })
        .then((next) => setPendingDeltas(next))
        .catch(() => {
          // Keep stale values if RPC read fails temporarily.
        });
    }, 15_000);

    return () => window.clearInterval(id);
  }, [open, pool, poolAddress]);

  if (!(open && mounted)) {
    return null;
  }

  const isPending = phase === "pending";
  const buttonText = phase === "done" && mintedLp === 0n ? "No LP minted" : getButtonText(phase);

  const basePositive = Number.parseFloat(baseAmount || "0") > 0;
  const fyPositive = Number.parseFloat(fyAmount || "0") > 0;
  const canSubmit =
    basePositive &&
    fyPositive &&
    pool.baseDecimals !== null &&
    pool.fyDecimals !== null &&
    !hasPendingPoolDeltas &&
    !isMatured &&
    !isPending;
  const canSyncPool = !(isPending || isSyncingPool || isMatured) && hasPendingPoolDeltas;
  const canApplyRatioFix =
    phase === "error" &&
    !isPending &&
    mintErrorHint?.kind === "notEnoughBase" &&
    pool.baseDecimals !== null;
  const canApplyFyLimitFix =
    !isPending &&
    fyLimitingAfterFix &&
    pool.baseDecimals !== null &&
    pool.fyDecimals !== null &&
    typeof pool.userFyBal === "bigint";
  const syncPoolButtonText = isSyncingPool ? "Syncing pool…" : "Recover / Sync pool";

  const close = () => {
    if (isPending) {
      return;
    }
    onOpenChange(false);
  };

  const autoBase = () => void computeBaseQuote();

  const applyFyLimitFix = () => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Keeps user-facing fix flow atomic and state-safe.
    const run = async () => {
      if (
        pool.baseDecimals === null ||
        pool.fyDecimals === null ||
        typeof pool.userFyBal !== "bigint"
      ) {
        return;
      }
      const userFyBal = pool.userFyBal;
      try {
        const ratioWad = await readPoolRatioWad({ poolAddress });
        if (ratioWad === null || ratioWad <= 0n) {
          setQuoteError("Pool ratio unavailable.");
          return;
        }
        const baseRaw = (userFyBal * ratioWad) / 10n ** 18n;
        const safeBaseRaw = baseRaw > 1n ? baseRaw - 1n : baseRaw;
        setBaseAmount(formatUnits(safeBaseRaw, pool.baseDecimals));
        setFyAmount(formatUnits(userFyBal, pool.fyDecimals));
        setFyLimitingAfterFix(false);
        setError(null);
        setMintErrorHint(null);
        setPhase("idle");
        setQuoteError("FY balance is limiting. Base was fitted to max FY at current pool ratio.");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to fit base to FY.");
      }
    };

    void run();
  };

  const applyRatioFix = () => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Fresh reads + fallback handling are intentionally in one guarded flow.
    const run = async () => {
      if (
        mintErrorHint?.kind !== "notEnoughBase" ||
        pool.baseDecimals === null ||
        pool.fyDecimals === null
      ) {
        return;
      }

      try {
        const pending = await readPendingDeltas({ poolAddress });
        if (pending.baseDelta !== 0n || pending.fyDelta !== 0n) {
          setError("Pool has pending balances. Click Recover / Sync pool, then retry.");
          return;
        }

        const ratioWad = await readPoolRatioWad({ poolAddress });
        if (ratioWad === null || ratioWad <= 0n) {
          setQuoteError("Pool ratio unavailable.");
          return;
        }

        const ratioBuffer = mintErrorHint.baseNeeded / 10_000n;
        const buffer = ratioBuffer > 1n ? ratioBuffer : 1n;
        const targetBase = mintErrorHint.baseNeeded + buffer;
        const targetFy = (targetBase * 10n ** 18n) / ratioWad;
        setBaseAmount(formatUnits(targetBase, pool.baseDecimals));

        if (typeof pool.userFyBal === "bigint" && targetFy > pool.userFyBal) {
          const userFyBal = pool.userFyBal;
          setFyAmount(formatUnits(userFyBal, pool.fyDecimals));
          setFyLimitingAfterFix(true);
          setQuoteError(
            `FY is now limiting. Needed ${formatTokenAmount(targetFy, pool.fyDecimals)} ${pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol}, available ${formatTokenAmount(userFyBal, pool.fyDecimals)}. Click "Fit base to max fy".`
          );
        } else {
          setFyAmount(formatUnits(targetFy, pool.fyDecimals));
          setFyLimitingAfterFix(false);
          setQuoteError("Adjusted to fresh pool ratio with base set to needed + 0.01% buffer.");
        }

        setError(null);
        setMintErrorHint(null);
        setPhase("idle");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to apply ratio fix.");
      }
    };

    void run();
  };

  const syncPool = () => {
    const run = async () => {
      setIsSyncingPool(true);
      setError(null);
      setMintErrorHint(null);
      setFyLimitingAfterFix(false);
      setQuoteError(null);
      setSyncTxHash(null);
      try {
        const synced = await recoverOrSyncPool({
          baseDecimals: pool.baseDecimals,
          baseSymbol: pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
          fyDecimals: pool.fyDecimals,
          fySymbol: pool.fySymbol ?? CELO_YIELD_POOL.fyToken.symbol,
          poolAddress,
          userAddress,
          walletClient: walletClient as WalletClient | null,
        });
        if (synced.txHash) {
          setSyncTxHash(synced.txHash);
          setQuoteError(synced.summary);
        } else {
          setQuoteError(synced.summary);
        }
        try {
          const next = await readPendingDeltas({ poolAddress });
          setPendingDeltas(next);
        } catch {
          // Keep stale values if RPC read fails temporarily.
        }
        pool.refetch();
      } catch (caught) {
        setPhase("error");
        setError(caught instanceof Error ? caught.message : "Pool sync failed.");
      } finally {
        setIsSyncingPool(false);
      }
    };

    void run();
  };

  const submit = () => {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Submit flow intentionally keeps guardrails in one place.
    const run = async () => {
      setPhase("pending");
      setError(null);
      setMintErrorHint(null);
      setFyLimitingAfterFix(false);
      setQuoteError(null);
      setTxHash(null);
      setMintedLp(null);
      setBaseRefund(null);
      setFyRefund(null);
      setBaseUsed(null);
      setFyUsed(null);
      setAmountsUnavailable(false);

      if (isMatured) {
        setPhase("error");
        setError("This pool has matured. New liquidity cannot be added to this series.");
        return;
      }
      if (hasPendingPoolDeltas) {
        setPhase("error");
        setError("Pool has pending balances. Click Recover / Sync pool, then retry.");
        return;
      }

      try {
        const { result, retried, retryNote } = await addLiquidityFlowWithRetry({
          baseAmount,
          fyAmount,
          pool,
          poolAddress,
          ratioSlippageBps,
          relaxRatioCheck,
          userAddress,
          walletClient: walletClient as WalletClient | null,
        });

        if (retried) {
          setRelaxRatioCheck(true);
          setQuoteError(retryNote ?? "Retried automatically.");
        }

        setTxHash(result.txHash);
        setMintedLp(result.mintedLp);
        setBaseRefund(result.baseRefund);
        setFyRefund(result.fyRefund);
        setBaseUsed(result.baseUsed);
        setFyUsed(result.fyUsed);
        setAmountsUnavailable(result.amountsUnavailable);

        pool.refetch();
        void readPendingDeltas({ poolAddress })
          .then((next) => setPendingDeltas(next))
          .catch(() => {
            // Keep stale values if RPC read fails temporarily.
          });
        setPhase("done");
      } catch (caught) {
        setPhase("error");
        if (caught instanceof MintFlowError) {
          setMintErrorHint(caught.hint);
          setError(caught.message);
          return;
        }
        const helperAddress = readCachedHelperAddress();
        const hint = decodeMintErrorHint(caught, {
          helperAddress,
          poolAddress,
        });
        setMintErrorHint(hint);
        const selector =
          getRevertInfo(caught, { helperAddress, poolAddress }).selector ??
          getRevertSelector(caught);
        if (hint || selector) {
          setError(
            formatContractFailure({
              baseDecimals: pool.baseDecimals ?? undefined,
              baseSymbol: pool.baseSymbol ?? CELO_YIELD_POOL.baseToken.symbol,
              caught,
              fallback: "Failed to add liquidity.",
              helperAddress,
              poolAddress,
              relaxRatioCheck,
            })
          );
          return;
        }
        setError(caught instanceof Error ? caught.message : "Failed to add liquidity.");
      }
    };

    void run();
  };

  const modal = (
    <AddLiquidityModalView
      amountsUnavailable={amountsUnavailable}
      baseAmount={baseAmount}
      baseBalanceText={formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
      baseDecimals={pool.baseDecimals}
      basePositionText={formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
      baseRefund={baseRefund}
      baseUsed={baseUsed}
      buttonText={buttonText}
      canApplyFyLimitFix={canApplyFyLimitFix}
      canApplyRatioFix={canApplyRatioFix}
      canSubmit={canSubmit}
      canSyncPool={canSyncPool}
      close={close}
      error={error}
      feeText={feeText}
      fyAmount={fyAmount}
      fyBalanceText={formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
      fyDecimals={pool.fyDecimals}
      fyPositionText={formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
      fyRefund={fyRefund}
      fyUsed={fyUsed}
      isMatured={isMatured}
      isPending={isPending}
      maturityLabel={maturityLabel}
      mintedLp={mintedLp}
      onApplyFyLimitFix={applyFyLimitFix}
      onApplyRatioFix={applyRatioFix}
      onAutoBase={autoBase}
      onChangeBaseAmount={setBaseAmount}
      onChangeFyAmount={setFyAmount}
      onChangeRatioSlippageBps={setRatioSlippageBps}
      onChangeRelaxRatioCheck={setRelaxRatioCheck}
      onSyncPool={syncPool}
      onToggleSettings={() => setShowSettings((value) => !value)}
      pendingStatusText={pendingStatusText}
      phase={phase}
      poolName={poolName}
      quoteError={quoteError}
      ratioSlippageBps={ratioSlippageBps}
      relaxRatioCheck={relaxRatioCheck}
      showSettings={showSettings}
      submit={submit}
      syncPoolButtonText={syncPoolButtonText}
      syncTxHash={syncTxHash}
      txHash={txHash}
    />
  );

  // Render outside any transformed/backdrop-filtered ancestors so the fixed overlay is truly viewport-centered.
  return createPortal(modal, document.body);
}
