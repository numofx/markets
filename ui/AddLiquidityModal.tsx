"use client";

import { Settings, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { Address } from "viem";
import { decodeEventLog, formatUnits, parseUnits, zeroAddress } from "viem";
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
  if (baseParsed <= 0n || fyParsed <= 0n) {
    throw new Error("Enter both amounts.");
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

  const receipt = await publicClient.waitForTransactionReceipt({ hash: mintHash });
  return { mintHash, receipt };
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

  const mintResult = await mintLiquidity({
    maxRatio,
    minRatio,
    poolAddress: params.poolAddress,
    userAddress: ctx.userAddress,
    walletClient: ctx.walletClient,
  });

  const { baseRefund, fyRefund, mintedLp } = decodeTransfers({
    baseToken: ctx.baseToken,
    fyToken: ctx.fyToken,
    logs: mintResult.receipt.logs as unknown as readonly {
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
    baseHash,
    baseRefund,
    baseUsed,
    fyHash,
    fyRefund,
    fyUsed,
    mintedLp,
    mintHash: mintResult.mintHash,
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
    </div>
  );
}

function TokenAmountCard(props: {
  value: string;
  onChangeValue: (value: string) => void;
  symbol: string;
  balanceText: string;
}) {
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
          <span className="mt-2 text-numo-muted text-sm">{props.balanceText}</span>
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
  fyAmount: string;
  onChangeFyAmount: (value: string) => void;
  baseAmount: string;
  onChangeBaseAmount: (value: string) => void;
  fyBalanceText: string;
  baseBalanceText: string;
  fyPositionText: string;
  basePositionText: string;
  transferBaseHash: `0x${string}` | null;
  transferFyHash: `0x${string}` | null;
  mintHash: `0x${string}` | null;
  phase: Phase;
  error: string | null;
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
            open={props.showSettings}
            ratioSlippageBps={props.ratioSlippageBps}
          />

          <div className="mt-6 space-y-4">
            <TokenAmountCard
              balanceText={props.fyBalanceText}
              onChangeValue={props.onChangeFyAmount}
              symbol={CELO_YIELD_POOL.fyToken.symbol}
              value={props.fyAmount}
            />
            <TokenAmountCard
              balanceText={props.baseBalanceText}
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

          <TxHashLine hash={props.transferBaseHash} label="Base transfer" />
          <TxHashLine hash={props.transferFyHash} label="FY transfer" />
          <TxHashLine hash={props.mintHash} label="Mint" />

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
  const [showSettings, setShowSettings] = useState(false);
  const [ratioSlippageBps, setRatioSlippageBps] = useState(`${DEFAULT_RATIO_SLIPPAGE_BPS}`);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const [transferBaseHash, setTransferBaseHash] = useState<`0x${string}` | null>(null);
  const [transferFyHash, setTransferFyHash] = useState<`0x${string}` | null>(null);
  const [mintHash, setMintHash] = useState<`0x${string}` | null>(null);
  const [mintedLp, setMintedLp] = useState<bigint | null>(null);
  const [baseRefund, setBaseRefund] = useState<bigint | null>(null);
  const [fyRefund, setFyRefund] = useState<bigint | null>(null);
  const [baseUsed, setBaseUsed] = useState<bigint | null>(null);
  const [fyUsed, setFyUsed] = useState<bigint | null>(null);

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
    if (!open) {
      return;
    }

    setPhase("idle");
    setError(null);
    setTransferBaseHash(null);
    setTransferFyHash(null);
    setMintHash(null);
    setMintedLp(null);
    setBaseRefund(null);
    setFyRefund(null);
    setBaseUsed(null);
    setFyUsed(null);
  }, [open]);

  if (!(open && mounted)) {
    return null;
  }

  const isPending = phase === "pending";
  const buttonText = getButtonText(phase);

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

  const submit = () => {
    const run = async () => {
      setPhase("pending");
      setError(null);
      setTransferBaseHash(null);
      setTransferFyHash(null);
      setMintHash(null);
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
      mintHash={mintHash}
      onChangeBaseAmount={setBaseAmount}
      onChangeFyAmount={setFyAmount}
      onChangeRatioSlippageBps={setRatioSlippageBps}
      onToggleSettings={() => setShowSettings((value) => !value)}
      phase={phase}
      poolName={poolName}
      ratioSlippageBps={ratioSlippageBps}
      showSettings={showSettings}
      submit={submit}
      transferBaseHash={transferBaseHash}
      transferFyHash={transferFyHash}
    />
  );

  // Render outside any transformed/backdrop-filtered ancestors so the fixed overlay is truly viewport-centered.
  return createPortal(modal, document.body);
}
