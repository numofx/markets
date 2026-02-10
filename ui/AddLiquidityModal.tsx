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
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { Button } from "@/ui/Button";

const MAX_UINT256 = 2n ** 256n - 1n;
const DEFAULT_RATIO_SLIPPAGE_BPS = 200n;
const WALLET_TIMEOUT_MS = 120_000;

type WalletClient = NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;

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

async function getOrDeployMintHelper(params: { walletClient: WalletClient; userAddress: Address }) {
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
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
  assertReceiptSuccess({ context: "Approve", status: receipt.status });
}

async function readPoolRatioWad(params: { poolAddress: Address }) {
  const [cacheRaw, totalSupplyRaw, baseBalanceRaw, fyBalanceRaw] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: params.poolAddress, functionName: "getCache" },
      { abi: erc20Abi, address: params.poolAddress, functionName: "totalSupply" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getBaseBalance" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getFYTokenBalance" },
    ],
  });

  const cache = cacheRaw as unknown as readonly [bigint, bigint, number];
  const totalSupply = totalSupplyRaw as unknown as bigint;
  const baseBalance = baseBalanceRaw as unknown as bigint;
  const fyBalance = fyBalanceRaw as unknown as bigint;

  const baseCached = cache[0];
  const fyCached = cache[1];

  // If the pool has "pending" tokens (balances don't match cache), minting can behave unexpectedly.
  // Safer to fail fast and ask the user to try again later.
  if (baseBalance !== baseCached || fyBalance !== fyCached) {
    throw new Error("Pool is mid-update (pending balances). Try again in a minute.");
  }

  // Yield v2 pool cache holds fyToken reserves plus outstanding LP supply.
  // Real fyToken reserves are `fyCached - (totalSupply - 1)` (with edge cases).
  const totalSupplyMinusOne = totalSupply > 0n ? totalSupply - 1n : 0n;
  const realFyCached = fyCached > totalSupplyMinusOne ? fyCached - totalSupplyMinusOne : 0n;
  if (realFyCached <= 0n) {
    return null;
  }

  return (baseCached * 10n ** 18n) / realFyCached;
}

async function assertPoolClean(params: { poolAddress: Address }) {
  const [cacheRaw, baseBalanceRaw, fyBalanceRaw] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: params.poolAddress, functionName: "getCache" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getBaseBalance" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getFYTokenBalance" },
    ],
  });

  const cache = cacheRaw as unknown as readonly [bigint, bigint, number];
  const baseBalance = baseBalanceRaw as unknown as bigint;
  const fyBalance = fyBalanceRaw as unknown as bigint;

  const baseCached = cache[0];
  const fyCached = cache[1];

  if (baseBalance !== baseCached || fyBalance !== fyCached) {
    throw new Error("Pool is mid-update (pending balances). Try again in a minute.");
  }
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

function decodeTransfers(params: {
  logs: readonly { address: Address; data: `0x${string}`; topics: readonly `0x${string}`[] }[];
  userAddress: Address;
  poolAddress: Address;
  baseToken: Address;
  fyToken: Address;
}) {
  let mintedLp = 0n;
  let baseRefund = 0n;
  let fyRefund = 0n;

  for (const log of params.logs) {
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

      const from = decoded.args.from as Address;
      const to = decoded.args.to as Address;
      const value = decoded.args.value as bigint;

      if (log.address === params.poolAddress && from === zeroAddress && to === params.userAddress) {
        mintedLp += value;
      }

      if (
        log.address === params.baseToken &&
        from === params.poolAddress &&
        to === params.userAddress
      ) {
        baseRefund += value;
      }

      if (
        log.address === params.fyToken &&
        from === params.poolAddress &&
        to === params.userAddress
      ) {
        fyRefund += value;
      }
    } catch {
      // Ignore non-ERC20 Transfer logs and any decoding mismatches.
    }
  }

  return { baseRefund, fyRefund, mintedLp };
}

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

  await assertPoolClean({ poolAddress: params.poolAddress });

  const { maxRatio, minRatio } = params.relaxRatioCheck
    ? { maxRatio: MAX_UINT256, minRatio: 0n }
    : await readMintRatios({
        poolAddress: params.poolAddress,
        ratioSlippageBps: ratioBps,
      });

  const helperAddress = await getOrDeployMintHelper({
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  await ensureAllowance({
    amount: baseParsed,
    spender: helperAddress,
    token: ctx.baseToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });
  await ensureAllowance({
    amount: fyParsed,
    spender: helperAddress,
    token: ctx.fyToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  let txHash: `0x${string}`;
  try {
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
      }),
      WALLET_TIMEOUT_MS,
      "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
    );
  } catch (caught) {
    const selector = getRevertSelector(caught);
    const message = caught instanceof Error ? caught.message : "Failed to add liquidity.";
    throw new Error(selector ? `${message} (revert ${selector})` : message);
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
  assertReceiptSuccess({ context: "Add liquidity", status: receipt.status });

  const { baseRefund, fyRefund, mintedLp } = decodeTransfers({
    baseToken: ctx.baseToken,
    fyToken: ctx.fyToken,
    logs: receipt.logs as unknown as readonly {
      address: Address;
      data: `0x${string}`;
      topics: readonly `0x${string}`[];
    }[],
    poolAddress: params.poolAddress,
    userAddress: ctx.userAddress,
  });

  const baseUsed = baseParsed > baseRefund ? baseParsed - baseRefund : 0n;
  const fyUsed = fyParsed > fyRefund ? fyParsed - fyRefund : 0n;

  return {
    baseRefund,
    baseUsed,
    fyRefund,
    fyUsed,
    mintedLp,
    txHash,
  };
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
    props.baseUsed === null || props.baseDecimals === null
      ? "—"
      : `${formatUnits(props.baseUsed, props.baseDecimals)} ${props.baseSymbol}`;
  const fyUsedText =
    props.fyUsed === null || props.fyDecimals === null
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
  phase: Phase;
  error: string | null;
  quoteError: string | null;
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
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-600">In range</span>
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

          <MintOutcomeCard
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

          {props.phase === "error" ? (
            <p className="mt-4 text-red-700 text-sm">{props.error ?? "Transaction failed."}</p>
          ) : null}

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

  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [mintedLp, setMintedLp] = useState<bigint | null>(null);
  const [baseRefund, setBaseRefund] = useState<bigint | null>(null);
  const [fyRefund, setFyRefund] = useState<bigint | null>(null);
  const [baseUsed, setBaseUsed] = useState<bigint | null>(null);
  const [fyUsed, setFyUsed] = useState<bigint | null>(null);

  const poolName = `${CELO_YIELD_POOL.fyToken.symbol} / ${CELO_YIELD_POOL.baseToken.symbol}`;
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;

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
    setQuoteError(null);
    setRelaxRatioCheck(false);
    setTxHash(null);
    setMintedLp(null);
    setBaseRefund(null);
    setFyRefund(null);
    setBaseUsed(null);
    setFyUsed(null);

    // Balances can change outside this modal (swaps, mints, faucets, etc).
    // Refetch immediately on open so the "position" rows reflect current onchain state.
    pool.refetch();
  }, [open, pool.refetch]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const id = window.setInterval(() => {
      pool.refetch();
    }, 15_000);

    return () => window.clearInterval(id);
  }, [open, pool]);

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
    !isPending;

  const close = () => {
    if (isPending) {
      return;
    }
    onOpenChange(false);
  };

  const autoBase = () => void computeBaseQuote();

  const submit = () => {
    const run = async () => {
      setPhase("pending");
      setError(null);
      setQuoteError(null);
      setTxHash(null);
      setMintedLp(null);
      setBaseRefund(null);
      setFyRefund(null);
      setBaseUsed(null);
      setFyUsed(null);

      try {
        const result = await addLiquidityFlow({
          baseAmount,
          fyAmount,
          pool,
          poolAddress,
          ratioSlippageBps,
          relaxRatioCheck,
          userAddress,
          walletClient: walletClient as WalletClient | null,
        });

        setTxHash(result.txHash);
        setMintedLp(result.mintedLp);
        setBaseRefund(result.baseRefund);
        setFyRefund(result.fyRefund);
        setBaseUsed(result.baseUsed);
        setFyUsed(result.fyUsed);

        pool.refetch();
        setPhase("done");
      } catch (caught) {
        setPhase("error");
        setError(caught instanceof Error ? caught.message : "Failed to add liquidity.");
      }
    };

    void run();
  };

  const modal = (
    <AddLiquidityModalView
      baseAmount={baseAmount}
      baseBalanceText={formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
      baseDecimals={pool.baseDecimals}
      basePositionText={formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
      baseRefund={baseRefund}
      baseUsed={baseUsed}
      buttonText={buttonText}
      canSubmit={canSubmit}
      close={close}
      error={error}
      feeText={feeText}
      fyAmount={fyAmount}
      fyBalanceText={formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
      fyDecimals={pool.fyDecimals}
      fyPositionText={formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
      fyRefund={fyRefund}
      fyUsed={fyUsed}
      isPending={isPending}
      mintedLp={mintedLp}
      onAutoBase={autoBase}
      onChangeBaseAmount={setBaseAmount}
      onChangeFyAmount={setFyAmount}
      onChangeRatioSlippageBps={setRatioSlippageBps}
      onChangeRelaxRatioCheck={setRelaxRatioCheck}
      onToggleSettings={() => setShowSettings((value) => !value)}
      phase={phase}
      poolName={poolName}
      quoteError={quoteError}
      ratioSlippageBps={ratioSlippageBps}
      relaxRatioCheck={relaxRatioCheck}
      showSettings={showSettings}
      submit={submit}
      txHash={txHash}
    />
  );

  // Render outside any transformed/backdrop-filtered ancestors so the fixed overlay is truly viewport-centered.
  return createPortal(modal, document.body);
}
