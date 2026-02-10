"use client";

import { Settings, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Address } from "viem";
import { formatUnits, parseUnits } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
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
    return "Liquidity added";
  }
  return "Add liquidity";
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
  if (baseParsed <= 0n && fyParsed <= 0n) {
    throw new Error("Enter an amount.");
  }
  return { baseParsed, fyParsed };
}

function transferToPool(params: {
  walletClient: WalletClient;
  userAddress: Address;
  token: Address;
  poolAddress: Address;
  amount: bigint;
}) {
  if (params.amount <= 0n) {
    return null;
  }

  return withTimeout(
    params.walletClient.writeContract({
      abi: erc20Abi,
      account: params.userAddress,
      address: params.token,
      args: [params.poolAddress, params.amount],
      chain: celo,
      functionName: "transfer",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  ).then(async (hash) => {
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  });
}

async function readMintRatios(params: { poolAddress: Address; ratioSlippageBps: bigint }) {
  const [cacheRaw, totalSupplyRaw] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: params.poolAddress, functionName: "getCache" },
      { abi: erc20Abi, address: params.poolAddress, functionName: "totalSupply" },
    ],
  });

  const cache = cacheRaw as unknown as readonly [bigint, bigint, number];
  const totalSupply = totalSupplyRaw as unknown as bigint;

  const baseCached = cache[0];
  const fyCached = cache[1];
  const realFyCached = fyCached > totalSupply ? fyCached - totalSupply : 0n;
  if (realFyCached <= 0n) {
    return { maxRatio: MAX_UINT256, minRatio: 0n };
  }

  const ratioWad = (baseCached * 10n ** 18n) / realFyCached;
  const minRatio = (ratioWad * (10_000n - params.ratioSlippageBps)) / 10_000n;
  const maxRatio = (ratioWad * (10_000n + params.ratioSlippageBps)) / 10_000n;
  return { maxRatio, minRatio };
}

async function mintLiquidity(params: {
  walletClient: WalletClient;
  userAddress: Address;
  poolAddress: Address;
  minRatio: bigint;
  maxRatio: bigint;
}) {
  const mintHash = await withTimeout(
    params.walletClient.writeContract({
      abi: poolAbi,
      account: params.userAddress,
      address: params.poolAddress,
      args: [params.userAddress, params.userAddress, params.minRatio, params.maxRatio],
      chain: celo,
      functionName: "mint",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );

  await publicClient.waitForTransactionReceipt({ hash: mintHash });
  return mintHash;
}

async function addLiquidityFlow(params: {
  baseAmount: string;
  fyAmount: string;
  ratioSlippageBps: string;
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

  const ratioBps = parseRatioSlippageBps(params.ratioSlippageBps);

  const baseHash = await transferToPool({
    amount: baseParsed,
    poolAddress: params.poolAddress,
    token: ctx.baseToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  const fyHash = await transferToPool({
    amount: fyParsed,
    poolAddress: params.poolAddress,
    token: ctx.fyToken,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  const { maxRatio, minRatio } = await readMintRatios({
    poolAddress: params.poolAddress,
    ratioSlippageBps: ratioBps,
  });

  const mintHash = await mintLiquidity({
    maxRatio,
    minRatio,
    poolAddress: params.poolAddress,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  return { baseHash, fyHash, mintHash };
}

type AddLiquidityModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feeText: string;
};

type Phase = "idle" | "pending" | "done" | "error";

export function AddLiquidityModal({ open, onOpenChange, feeText }: AddLiquidityModalProps) {
  const [mounted, setMounted] = useState(false);
  const userAddress = usePrivyAddress();
  const { walletClient } = usePrivyWalletClient();
  const pool = usePoolReads(userAddress);

  const [baseAmount, setBaseAmount] = useState("");
  const [fyAmount, setFyAmount] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [ratioSlippageBps, setRatioSlippageBps] = useState(`${DEFAULT_RATIO_SLIPPAGE_BPS}`);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [transferBaseHash, setTransferBaseHash] = useState<`0x${string}` | null>(null);
  const [transferFyHash, setTransferFyHash] = useState<`0x${string}` | null>(null);
  const [mintHash, setMintHash] = useState<`0x${string}` | null>(null);

  const poolName = `${CELO_YIELD_POOL.fyToken.symbol} / ${CELO_YIELD_POOL.baseToken.symbol}`;
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;

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
    if (open) {
      setPhase("idle");
      setError(null);
      setTransferBaseHash(null);
      setTransferFyHash(null);
      setMintHash(null);
    }
  }, [open]);

  if (!open) {
    return null;
  }
  if (!mounted) {
    return null;
  }

  const isPending = phase === "pending";

  const close = () => {
    if (!isPending) {
      onOpenChange(false);
    }
  };

  const submit = async () => {
    setPhase("pending");
    setError(null);
    setTransferBaseHash(null);
    setTransferFyHash(null);
    setMintHash(null);

    try {
      const result = await addLiquidityFlow({
        baseAmount,
        fyAmount,
        pool,
        poolAddress,
        ratioSlippageBps,
        userAddress,
        walletClient: walletClient as WalletClient | null,
      });

      if (result.baseHash) {
        setTransferBaseHash(result.baseHash);
      }
      if (result.fyHash) {
        setTransferFyHash(result.fyHash);
      }
      setMintHash(result.mintHash);

      pool.refetch();
      setPhase("done");
    } catch (caught) {
      setPhase("error");
      setError(caught instanceof Error ? caught.message : "Failed to add liquidity.");
    }
  };

  const canSubmit = Boolean(baseAmount || fyAmount) && !isPending;
  const buttonText = getButtonText(phase);

  const modal = (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-8">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/40"
        onClick={() => close()}
        type="button"
      />
      <div className="relative w-full max-w-xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5">
          <button
            aria-label="Close"
            className="rounded-full p-2 text-numo-muted hover:bg-black/5 hover:text-numo-ink"
            disabled={isPending}
            onClick={() => close()}
            type="button"
          >
            <X className="h-6 w-6" />
          </button>
          <h2 className="font-semibold text-lg text-numo-ink">Add liquidity</h2>
          <button
            aria-label="Settings"
            className="rounded-full p-2 text-numo-muted hover:bg-black/5 hover:text-numo-ink"
            onClick={() => setShowSettings((value) => !value)}
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
                <p className="truncate font-semibold text-numo-ink text-xl">{poolName}</p>
                <span className="rounded-xl border border-numo-border bg-white px-3 py-1 text-numo-muted text-xs">
                  {feeText}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-emerald-600">In range</span>
              </div>
            </div>
          </div>

          {showSettings ? (
            <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3">
              <label className="flex flex-col gap-2">
                <span className="text-numo-muted text-xs">Ratio slippage (bps)</span>
                <input
                  className="w-full rounded-xl border border-numo-border bg-white px-3 py-2 text-numo-ink text-sm outline-none focus:border-numo-ink/30"
                  inputMode="numeric"
                  onChange={(e) => setRatioSlippageBps(e.target.value)}
                  value={ratioSlippageBps}
                />
              </label>
              <p className="mt-2 text-numo-muted text-xs">
                Safety bounds for the pool’s cached base/fy ratio when minting.
              </p>
            </div>
          ) : null}

          <div className="mt-6 space-y-4">
            <div className="rounded-3xl bg-numo-pill p-5">
              <div className="flex items-start justify-between gap-4">
                <input
                  className="w-full bg-transparent text-5xl text-numo-ink placeholder:text-numo-muted/40 focus:outline-none"
                  inputMode="decimal"
                  onChange={(e) => setFyAmount(e.target.value)}
                  placeholder="0"
                  value={fyAmount}
                />
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white">
                      <Image
                        alt={CELO_YIELD_POOL.fyToken.symbol}
                        height={36}
                        src="/assets/KESm (Mento Kenyan Shilling).svg"
                        width={36}
                      />
                    </span>
                    <span className="font-semibold text-2xl text-numo-ink">
                      {CELO_YIELD_POOL.fyToken.symbol}
                    </span>
                  </div>
                  <span className="mt-2 text-numo-muted text-sm">
                    {formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-3xl bg-numo-pill p-5">
              <div className="flex items-start justify-between gap-4">
                <input
                  className="w-full bg-transparent text-5xl text-numo-ink placeholder:text-numo-muted/40 focus:outline-none"
                  inputMode="decimal"
                  onChange={(e) => setBaseAmount(e.target.value)}
                  placeholder="0"
                  value={baseAmount}
                />
                <div className="flex flex-col items-end">
                  <div className="flex items-center gap-2">
                    <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white">
                      <Image
                        alt={CELO_YIELD_POOL.baseToken.symbol}
                        height={36}
                        src="/assets/KESm (Mento Kenyan Shilling).svg"
                        width={36}
                      />
                    </span>
                    <span className="font-semibold text-2xl text-numo-ink">
                      {CELO_YIELD_POOL.baseToken.symbol}
                    </span>
                  </div>
                  <span className="mt-2 text-numo-muted text-sm">
                    {formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-numo-border bg-white px-5 py-4">
            <div className="flex items-center justify-between text-numo-muted text-sm">
              <span>{CELO_YIELD_POOL.fyToken.symbol} position</span>
              <span className="font-medium text-numo-ink">
                {formatToken(pool.userFyBal ?? null, pool.fyDecimals, pool.fySymbol)}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-numo-muted text-sm">
              <span>{CELO_YIELD_POOL.baseToken.symbol} position</span>
              <span className="font-medium text-numo-ink">
                {formatToken(pool.userBaseBal ?? null, pool.baseDecimals, pool.baseSymbol)}
              </span>
            </div>
          </div>

          {transferBaseHash ? (
            <p className="mt-4 break-all text-numo-muted text-xs">
              Base transfer: {transferBaseHash}
            </p>
          ) : null}
          {transferFyHash ? (
            <p className="mt-1 break-all text-numo-muted text-xs">FY transfer: {transferFyHash}</p>
          ) : null}
          {mintHash ? (
            <p className="mt-1 break-all text-numo-muted text-xs">Mint: {mintHash}</p>
          ) : null}

          {phase === "error" ? (
            <p className="mt-4 text-red-700 text-sm">{error ?? "Transaction failed."}</p>
          ) : null}

          <div className="mt-6">
            <Button
              className={cn("w-full justify-center text-base", canSubmit ? null : "opacity-60")}
              disabled={!canSubmit}
              onClick={() => void submit()}
              size="lg"
              type="button"
              variant="secondary"
            >
              {buttonText}
            </Button>
          </div>

          <p className="mt-3 text-center text-numo-muted text-xs">
            Tokens are transferred to the pool, then minted into LP shares.
          </p>
        </div>
      </div>
    </div>
  );

  // Render outside any transformed/backdrop-filtered ancestors so the fixed overlay is truly viewport-centered.
  return createPortal(modal, document.body);
}
