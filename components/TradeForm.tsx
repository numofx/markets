"use client";

import { useEffect, useState } from "react";
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
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { AssetSelect } from "@/ui/AssetSelect";

type AssetOption = {
  code: string;
  name: string;
  flagSrc: string;
};

type TradeFormProps = {
  className?: string;
};

type Direction = "BASE_TO_FY" | "FY_TO_BASE";

const lendAssetOptions: AssetOption[] = [
  {
    code: "KESm",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
    name: "Kenyan Shilling",
  },
];

const receiveAssetOptions: AssetOption[] = [
  {
    code: "fyKESm",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
    name: "fyKESm",
  },
];

const U128_MAX = BigInt("340282366920938463463374607431768211455");
const DEFAULT_SLIPPAGE_BPS = 50n;
const MAX_SLIPPAGE_BPS = 1_000n;
const WALLET_TIMEOUT_MS = 120_000;
const noop = () => {
  // Intentionally empty.
};

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);

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

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "0";
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatTokenAmount(balance: bigint | null, decimals: number | null, symbol: string | null) {
  if (balance === null || decimals === null || !symbol) {
    return null;
  }
  return `${formatUnits(balance, decimals)} ${symbol}`;
}

function formatMetricValue(
  value: bigint | null,
  decimals: number | null,
  symbol: string | null,
  fallback: string
) {
  if (value === null || decimals === null) {
    return "—";
  }
  return `${formatUnits(value, decimals)} ${symbol ?? fallback}`;
}

function getMaturityLabel(maturity: number | null) {
  return maturity === null ? "—" : new Date(maturity * 1000).toLocaleString();
}

function useAprText(
  maturity: number | null,
  poolBaseBalance: bigint | null,
  poolFyBalance: bigint | null
) {
  const [aprText, setAprText] = useState("—");

  useEffect(() => {
    if (maturity === null || poolBaseBalance === null || poolFyBalance === null) {
      setAprText("—");
      return;
    }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = BigInt(maturity) - nowSeconds;
    if (timeRemaining <= 0n) {
      setAprText("—");
      return;
    }
    const priceWad = (poolBaseBalance * WAD) / poolFyBalance;
    const apr = aprFromPriceWad(priceWad, timeRemaining);
    setAprText(formatAprPercent(apr));
  }, [maturity, poolBaseBalance, poolFyBalance]);

  return aprText;
}

async function readFyOut(baseIn256: bigint, fyDecimals: number) {
  const fyOut = await publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [baseIn256],
    functionName: "sellBasePreview",
  });
  return formatNumber(Number.parseFloat(formatUnits(fyOut, fyDecimals)));
}

async function readBaseOut(fyIn256: bigint, baseDecimals: number) {
  const baseOut = await publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [fyIn256],
    functionName: "sellFYTokenPreview",
  });
  return formatNumber(Number.parseFloat(formatUnits(baseOut, baseDecimals)));
}

async function getQuoteResult(
  amount: string,
  direction: Direction,
  baseDecimals: number,
  fyDecimals: number
): Promise<{ quote: string; error: string | null }> {
  try {
    const parsedAmount =
      direction === "BASE_TO_FY"
        ? parseUnits(amount, baseDecimals)
        : parseUnits(amount, fyDecimals);
    if (parsedAmount > U128_MAX) {
      return { error: "Amount too large for pool preview.", quote: "0" };
    }
    const nextQuote =
      direction === "BASE_TO_FY"
        ? await readFyOut(parsedAmount, fyDecimals)
        : await readBaseOut(parsedAmount, baseDecimals);
    return { error: null, quote: nextQuote };
  } catch (caught) {
    return {
      error: caught instanceof Error ? caught.message : "Failed to quote",
      quote: "0",
    };
  }
}

function useQuote(
  amount: string,
  direction: Direction,
  baseDecimals: number | null,
  fyDecimals: number | null
) {
  const [quote, setQuote] = useState<string>("0");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (baseDecimals === null || fyDecimals === null || amount === "") {
      setQuote("0");
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);

    const timeout = setTimeout(() => {
      const runQuote = async () => {
        const result = await getQuoteResult(amount, direction, baseDecimals, fyDecimals);
        if (cancelled) {
          return;
        }
        setQuote(result.quote);
        setQuoteError(result.error);
        setQuoteLoading(false);
      };
      void runQuote();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [amount, baseDecimals, direction, fyDecimals]);

  return { quote, quoteError, quoteLoading };
}

type SwapParams = {
  amount: string;
  direction: Direction;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseToken: Address | null;
  fyToken: Address | null;
  userAddress: Address | undefined;
  walletClient: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]> | null;
  slippageBps: bigint;
  quoteError: string | null;
  quoteLoading: boolean;
  refetch: () => void;
};

type SwapPhase =
  | "idle"
  | "transfer_sign"
  | "transfer_pending"
  | "swap_sign"
  | "swap_pending"
  | "done"
  | "error";
type WalletContext =
  | {
      error: string;
    }
  | {
      client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;
      address: Address;
      token: Address;
    };

function useSwap({
  amount,
  direction,
  baseDecimals,
  fyDecimals,
  baseToken,
  fyToken,
  userAddress,
  walletClient,
  slippageBps,
  quoteError,
  quoteLoading,
  refetch,
}: SwapParams) {
  const [txLoading, setTxLoading] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [transferTxHash, setTransferTxHash] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<string | null>(null);
  const [amountInBase, setAmountInBase] = useState<bigint | null>(null);
  const [amountInFy, setAmountInFy] = useState<bigint | null>(null);
  const [expectedFyOut, setExpectedFyOut] = useState<bigint | null>(null);
  const [minFyOut, setMinFyOut] = useState<bigint | null>(null);
  const [expectedBaseOut, setExpectedBaseOut] = useState<bigint | null>(null);
  const [minBaseOut, setMinBaseOut] = useState<bigint | null>(null);
  const [hasTraded, setHasTraded] = useState(false);
  const [dimQuoteOnce, setDimQuoteOnce] = useState(false);
  const [phase, setPhase] = useState<SwapPhase>("idle");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const stored = window.localStorage.getItem("last_transfer_tx_hash");
    if (stored) {
      setTransferTxHash(stored);
    }
  }, []);

  useEffect(() => {
    if (!transferTxHash) {
      return;
    }
    if (!isHexHash(transferTxHash)) {
      setTransferTxHash(null);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem("last_transfer_tx_hash");
      }
      return;
    }
    if (phase === "swap_sign" || phase === "swap_pending" || phase === "done") {
      return;
    }

    let cancelled = false;
    const checkTransferReceipt = async () => {
      const nextPhase = await resolveTransferPhase(transferTxHash);
      if (cancelled) {
        return;
      }
      if (nextPhase === "reverted") {
        setPhase("idle");
        setTransferTxHash(null);
        if (typeof window !== "undefined") {
          window.localStorage.removeItem("last_transfer_tx_hash");
        }
        return;
      }
      setPhase(nextPhase);
    };

    void checkTransferReceipt();

    return () => {
      cancelled = true;
    };
  }, [phase, transferTxHash]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if ((phase === "transfer_pending" || phase === "done") && transferTxHash) {
      window.localStorage.setItem("last_transfer_tx_hash", transferTxHash);
    }
  }, [phase, transferTxHash]);

  useEffect(() => {
    if (!dimQuoteOnce) {
      return;
    }
    const frame = requestAnimationFrame(() => {
      setDimQuoteOnce(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [dimQuoteOnce]);

  useEffect(() => {
    if (phase !== "done") {
      return;
    }
    const timeoutId = setTimeout(() => {
      setPhase("idle");
    }, 8000);
    return () => clearTimeout(timeoutId);
  }, [phase]);

  const resetTradeState = () => {
    setPhase("idle");
    setTxError(null);
    setTxLoading(false);
    setSwapTxHash(null);
    setTransferTxHash(null);
    setHasTraded(false);
    setAmountInBase(null);
    setAmountInFy(null);
    setExpectedFyOut(null);
    setMinFyOut(null);
    setExpectedBaseOut(null);
    setMinBaseOut(null);
    if (typeof window !== "undefined") {
      window.localStorage.removeItem("last_transfer_tx_hash");
    }
  };

  const getSwapErrorMessage = (caught: unknown) => {
    if (caught instanceof Error) {
      if (caught.message.toLowerCase().includes("wallet timeout")) {
        return "Wallet confirmation timed out. Re-open your wallet and approve the transaction.";
      }
      return caught.message;
    }
    return "Swap failed.";
  };

  const waitForWalletConfirmation = (promise: Promise<`0x${string}`>) =>
    withTimeout(
      promise,
      WALLET_TIMEOUT_MS,
      "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
    );

  const transferTokenToPool = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    token: Address,
    requiredAmount: bigint
  ) => {
    setPhase("transfer_sign");
    const transferHash = await waitForWalletConfirmation(
      client.writeContract({
        abi: erc20Abi,
        account: address,
        address: token,
        args: [CELO_YIELD_POOL.poolAddress as Address, requiredAmount],
        chain: celo,
        functionName: "transfer",
      })
    );
    setTransferTxHash(transferHash);
    setPhase("transfer_pending");
    await publicClient.waitForTransactionReceipt({ hash: transferHash });
  };

  const executeSellBase = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    minOut: bigint
  ) => {
    setPhase("swap_sign");
    const sellHash = await waitForWalletConfirmation(
      client.writeContract({
        abi: poolAbi,
        account: address,
        address: CELO_YIELD_POOL.poolAddress as Address,
        args: [address, minOut],
        chain: celo,
        functionName: "sellBase",
      })
    );
    setSwapTxHash(sellHash);
    setPhase("swap_pending");
    await publicClient.waitForTransactionReceipt({ hash: sellHash });
  };

  const executeSellFy = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    minOut: bigint
  ) => {
    setPhase("swap_sign");
    const sellHash = await waitForWalletConfirmation(
      client.writeContract({
        abi: poolAbi,
        account: address,
        address: CELO_YIELD_POOL.poolAddress as Address,
        args: [address, minOut],
        chain: celo,
        functionName: "sellFYToken",
      })
    );
    setSwapTxHash(sellHash);
    setPhase("swap_pending");
    await publicClient.waitForTransactionReceipt({ hash: sellHash });
  };

  const isPending = phase === "transfer_pending" || phase === "swap_pending";

  const canSwap =
    Boolean(userAddress) &&
    Boolean(walletClient) &&
    Boolean(amount) &&
    baseDecimals !== null &&
    fyDecimals !== null &&
    (direction === "BASE_TO_FY" ? baseToken !== null : fyToken !== null) &&
    !quoteLoading &&
    quoteError === null &&
    !isPending &&
    !txLoading;

  const getSwapValidationError = () => {
    const parsed = Number.parseFloat(amount);
    const checks: [boolean, string][] = [
      [!userAddress, "Connect a wallet to continue."],
      [!walletClient, "Wallet client unavailable."],
      [baseDecimals === null || fyDecimals === null, "Pool data not ready."],
      [direction === "BASE_TO_FY" && baseToken === null, "Pool data not ready."],
      [direction === "FY_TO_BASE" && fyToken === null, "Pool data not ready."],
      [!amount || Number.isNaN(parsed) || parsed <= 0, "Enter an amount to swap."],
    ];
    const failed = checks.find(([condition]) => condition);
    return failed ? failed[1] : null;
  };

  const getWalletContext = (): WalletContext => {
    if (!(walletClient && userAddress)) {
      return { error: "Wallet not ready." };
    }
    if (direction === "BASE_TO_FY" && baseToken === null) {
      return { error: "Wallet not ready." };
    }
    if (direction === "FY_TO_BASE" && fyToken === null) {
      return { error: "Wallet not ready." };
    }
    return {
      address: userAddress,
      client: walletClient,
      token: direction === "BASE_TO_FY" ? (baseToken as Address) : (fyToken as Address),
    };
  };

  const getInputAmount = () => {
    if (direction === "BASE_TO_FY") {
      return parseUnits(amount, baseDecimals as number);
    }
    return parseUnits(amount, fyDecimals as number);
  };

  const executeBaseToFy = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    token: Address,
    inputAmount: bigint
  ) => {
    setAmountInBase(inputAmount);
    setAmountInFy(null);
    const fyOut = await publicClient.readContract({
      abi: poolAbi,
      address: CELO_YIELD_POOL.poolAddress as Address,
      args: [inputAmount],
      functionName: "sellBasePreview",
    });
    const nextMinFyOut = (fyOut * (10_000n - slippageBps)) / 10_000n;
    setExpectedFyOut(fyOut);
    setMinFyOut(nextMinFyOut);
    setExpectedBaseOut(null);
    setMinBaseOut(null);
    await transferTokenToPool(client, address, token, inputAmount);
    await executeSellBase(client, address, nextMinFyOut);
  };

  const executeFyToBase = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    token: Address,
    inputAmount: bigint
  ) => {
    setAmountInFy(inputAmount);
    setAmountInBase(null);
    const baseOut = await publicClient.readContract({
      abi: poolAbi,
      address: CELO_YIELD_POOL.poolAddress as Address,
      args: [inputAmount],
      functionName: "sellFYTokenPreview",
    });
    const nextMinBaseOut = (baseOut * (10_000n - slippageBps)) / 10_000n;
    setExpectedBaseOut(baseOut);
    setMinBaseOut(nextMinBaseOut);
    setExpectedFyOut(null);
    setMinFyOut(null);
    await transferTokenToPool(client, address, token, inputAmount);
    await executeSellFy(client, address, nextMinBaseOut);
  };

  const handleSwap = async () => {
    if (phase === "done" && hasTraded) {
      resetTradeState();
      return;
    }
    const validationError = getSwapValidationError();
    if (validationError) {
      setTxError(validationError);
      return;
    }
    const context = getWalletContext();
    if ("error" in context) {
      setTxError(context.error);
      return;
    }
    const { client, address, token } = context;
    setTxError(null);
    setSwapTxHash(null);
    setPhase("idle");
    setTxLoading(true);

    try {
      const inputAmount = getInputAmount();
      if (inputAmount > U128_MAX) {
        throw new Error("Amount too large for pool.");
      }
      if (direction === "BASE_TO_FY") {
        await executeBaseToFy(client, address, token, inputAmount);
      } else {
        await executeFyToBase(client, address, token, inputAmount);
      }
      refetch();
      setHasTraded(true);
      setDimQuoteOnce(true);
      setPhase("done");
    } catch (caught) {
      setTxError(getSwapErrorMessage(caught));
      setPhase("error");
    } finally {
      setTxLoading(false);
    }
  };

  return {
    amountInBase,
    amountInFy,
    canSwap,
    dimQuoteOnce,
    expectedBaseOut,
    expectedFyOut,
    handleSwap,
    hasTraded,
    isPending,
    minBaseOut,
    minFyOut,
    phase,
    resetTradeState,
    swapTxHash,
    transferTxHash,
    txError,
    txLoading,
  };
}

async function resolveTransferPhase(
  transferTxHash: `0x${string}`
): Promise<"swap_sign" | "transfer_pending" | "reverted"> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash: transferTxHash });
    return receipt.status === "reverted" ? "reverted" : "swap_sign";
  } catch {
    return "transfer_pending";
  }
}

function isHexHash(value: string): value is `0x${string}` {
  return value.startsWith("0x");
}

function getTransferStatus(phase: SwapPhase) {
  if (phase === "transfer_sign") {
    return "Waiting for transfer signature…";
  }
  if (phase === "transfer_pending") {
    return "Transfer pending…";
  }
  if (phase === "swap_sign" || phase === "swap_pending" || phase === "done") {
    return "Transfer confirmed";
  }
  if (phase === "error") {
    return "Transfer failed";
  }
  return "Idle";
}

function getSwapStatus(phase: SwapPhase) {
  if (phase === "swap_sign") {
    return "Waiting for swap signature…";
  }
  if (phase === "swap_pending") {
    return "Swap pending…";
  }
  if (phase === "done") {
    return "Swap confirmed";
  }
  if (phase === "error") {
    return "Swap failed";
  }
  return "Idle";
}

type SwapProgressProps = {
  direction: Direction;
  amountInBase: bigint | null;
  amountInFy: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  expectedFyOut: bigint | null;
  minFyOut: bigint | null;
  expectedBaseOut: bigint | null;
  minBaseOut: bigint | null;
  slippageBps: bigint;
  fyDecimals: number | null;
  fySymbol: string | null;
  transferTxHash: string | null;
  swapTxHash: string | null;
  phase: SwapPhase;
  dimQuoteOnce: boolean;
};

type SwapActionsProps = {
  canSwap: boolean;
  isPending: boolean;
  phase: SwapPhase;
  buttonLabel: string;
  onSwap: () => void;
  txError: string | null;
};

type SwapMetricsProps = {
  direction: Direction;
  amountInBase: bigint | null;
  amountInFy: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  expectedFyOut: bigint | null;
  minFyOut: bigint | null;
  expectedBaseOut: bigint | null;
  minBaseOut: bigint | null;
  slippageBps: bigint;
  fyDecimals: number | null;
  fySymbol: string | null;
  dimQuoteOnce: boolean;
};

type MetricRow = readonly [string, string];

function getBaseToFyMetricsRows({
  amountInBase,
  baseDecimals,
  baseSymbol,
  expectedFyOut,
  fyDecimals,
  fySymbol,
  minFyOut,
}: {
  amountInBase: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  expectedFyOut: bigint | null;
  fyDecimals: number | null;
  fySymbol: string | null;
  minFyOut: bigint | null;
}): MetricRow[] {
  return [
    ["amountInBase", formatMetricValue(amountInBase, baseDecimals, baseSymbol, "base")],
    ["expectedFyOut", formatMetricValue(expectedFyOut, fyDecimals, fySymbol, "fyToken")],
    ["minFyOut", formatMetricValue(minFyOut, fyDecimals, fySymbol, "fyToken")],
  ];
}

function getFyToBaseMetricsRows({
  amountInFy,
  fyDecimals,
  fySymbol,
  expectedBaseOut,
  baseDecimals,
  baseSymbol,
  minBaseOut,
}: {
  amountInFy: bigint | null;
  fyDecimals: number | null;
  fySymbol: string | null;
  expectedBaseOut: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  minBaseOut: bigint | null;
}): MetricRow[] {
  return [
    ["amountInFy", formatMetricValue(amountInFy, fyDecimals, fySymbol, "fyToken")],
    ["expectedBaseOut", formatMetricValue(expectedBaseOut, baseDecimals, baseSymbol, "base")],
    ["minBaseOut", formatMetricValue(minBaseOut, baseDecimals, baseSymbol, "base")],
  ];
}

function SwapMetrics({
  direction,
  amountInBase,
  amountInFy,
  baseDecimals,
  baseSymbol,
  expectedFyOut,
  minFyOut,
  expectedBaseOut,
  minBaseOut,
  slippageBps,
  fyDecimals,
  fySymbol,
  dimQuoteOnce,
}: SwapMetricsProps) {
  const rows =
    direction === "BASE_TO_FY"
      ? getBaseToFyMetricsRows({
          amountInBase,
          baseDecimals,
          baseSymbol,
          expectedFyOut,
          fyDecimals,
          fySymbol,
          minFyOut,
        })
      : getFyToBaseMetricsRows({
          amountInFy,
          baseDecimals,
          baseSymbol,
          expectedBaseOut,
          fyDecimals,
          fySymbol,
          minBaseOut,
        });

  return (
    <div className={cn("mt-3 text-black/50", dimQuoteOnce ? "opacity-50" : "")}>
      {rows.map(([label, value]) => (
        <div key={label}>
          {label}: {value}
        </div>
      ))}
      <div>Slippage: {slippageBps.toString()} bps</div>
      <div className="mt-1 text-[10px] text-black/40">min = expected * (1 - bps/10000)</div>
    </div>
  );
}

type SwapLinksProps = {
  transferTxHash: string | null;
  swapTxHash: string | null;
  phase: SwapPhase;
};

function SwapLinks({ transferTxHash, swapTxHash, phase }: SwapLinksProps) {
  const showTxLinks = phase === "transfer_pending" || phase === "swap_pending" || phase === "done";
  const transferHash = showTxLinks && transferTxHash ? transferTxHash : null;
  const swapHash = showTxLinks && swapTxHash ? swapTxHash : null;

  return (
    <div className="mt-3 space-y-1 text-black/50">
      {transferHash ? (
        <div>
          Transfer tx:{" "}
          <a
            className="text-black/70 underline-offset-2 hover:text-black"
            href={`https://celoscan.io/tx/${transferHash}`}
            rel="noreferrer"
            target="_blank"
          >
            {transferHash.slice(0, 10)}…
          </a>
        </div>
      ) : null}
      {swapHash ? (
        <div>
          Swap tx:{" "}
          <a
            className="text-black/70 underline-offset-2 hover:text-black"
            href={`https://celoscan.io/tx/${swapHash}`}
            rel="noreferrer"
            target="_blank"
          >
            {swapHash.slice(0, 10)}…
          </a>
        </div>
      ) : null}
    </div>
  );
}

function SwapActions({
  canSwap,
  isPending,
  phase,
  buttonLabel,
  onSwap,
  txError,
}: SwapActionsProps) {
  const isDisabled =
    !canSwap || isPending || phase === "transfer_pending" || phase === "swap_pending";

  return (
    <>
      <div className="mt-5 flex items-center gap-2">
        <button
          className={cn(
            "h-12 flex-1 rounded-2xl px-4 font-semibold text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,0.10)] transition-colors",
            canSwap
              ? "bg-black/80 hover:bg-black/90"
              : "cursor-not-allowed bg-black/10 text-black/30 shadow-none"
          )}
          disabled={isDisabled}
          onClick={onSwap}
          type="button"
        >
          {buttonLabel}
        </button>
      </div>
      {txError ? <div className="mt-2 text-center text-red-500 text-xs">{txError}</div> : null}
      {phase === "swap_sign" ? (
        <div className="mt-2 text-center text-black/60 text-xs">
          <div className="font-semibold text-black/70">
            Step 1 complete. Awaiting swap signature.
          </div>
        </div>
      ) : null}
    </>
  );
}

type ButtonLabelArgs = {
  phase: SwapPhase;
  userAddress: Address | undefined;
  txLoading: boolean;
  hasTraded: boolean;
  direction: Direction;
};

function getButtonLabel({ phase, userAddress, txLoading, hasTraded, direction }: ButtonLabelArgs) {
  if (!userAddress) {
    return "Connect wallet";
  }
  if (phase === "idle" && hasTraded) {
    return "Trade again";
  }
  if (phase === "transfer_sign") {
    return "Sign transfer";
  }
  if (phase === "transfer_pending") {
    return "Waiting for transfer…";
  }
  if (phase === "swap_sign") {
    return "Sign swap";
  }
  if (phase === "swap_pending") {
    return "Waiting for swap…";
  }
  if (phase === "done") {
    return "Done";
  }
  if (phase === "error") {
    return "Retry";
  }
  if (txLoading) {
    return "Swapping…";
  }
  return direction === "BASE_TO_FY" ? "Buy fyKESm" : "Buy KESm";
}

function SwapProgress({
  direction,
  amountInBase,
  amountInFy,
  baseDecimals,
  baseSymbol,
  expectedFyOut,
  minFyOut,
  expectedBaseOut,
  minBaseOut,
  slippageBps,
  fyDecimals,
  fySymbol,
  transferTxHash,
  swapTxHash,
  phase,
  dimQuoteOnce,
}: SwapProgressProps) {
  const transferLabel =
    direction === "BASE_TO_FY" ? "Step 1: Transfer base → pool" : "Step 1: Transfer fyToken → pool";
  const swapLabel =
    direction === "BASE_TO_FY" ? "Step 2: Swap base → fyToken" : "Step 2: Swap fyToken → base";

  return (
    <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-black/60 text-xs shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-semibold text-black/70">Progress</div>
      <div className="mt-2">
        <div className="text-black/70">{transferLabel}</div>
        <div className="mt-1 text-black/50">{getTransferStatus(phase)}</div>
      </div>
      <div className="mt-3">
        <div className="text-black/70">{swapLabel}</div>
        <div className="mt-1 text-black/50">{getSwapStatus(phase)}</div>
      </div>
      <SwapMetrics
        amountInBase={amountInBase}
        amountInFy={amountInFy}
        baseDecimals={baseDecimals}
        baseSymbol={baseSymbol}
        dimQuoteOnce={dimQuoteOnce}
        direction={direction}
        expectedBaseOut={expectedBaseOut}
        expectedFyOut={expectedFyOut}
        fyDecimals={fyDecimals}
        fySymbol={fySymbol}
        minBaseOut={minBaseOut}
        minFyOut={minFyOut}
        slippageBps={slippageBps}
      />
      <SwapLinks phase={phase} swapTxHash={swapTxHash} transferTxHash={transferTxHash} />
    </div>
  );
}

type DirectionToggleProps = {
  direction: Direction;
  onToggle: () => void;
};

function DirectionToggle({ direction, onToggle }: DirectionToggleProps) {
  return (
    <div className="mb-4 flex items-center justify-between rounded-2xl border border-black/10 bg-white px-4 py-3 text-black/70 text-xs shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <span>Direction</span>
      <button
        className="rounded-full border border-black/10 bg-black/5 px-3 py-1 font-semibold text-[11px] text-black/70 transition-colors hover:bg-black/10"
        onClick={onToggle}
        type="button"
      >
        {direction === "BASE_TO_FY" ? "Buy fyKESm" : "Buy KESm"}
      </button>
    </div>
  );
}

type PayCardProps = {
  amount: string;
  onAmountChange: (next: string) => void;
  options: AssetOption[];
  symbol: string;
};

function PayCard({ amount, onAmountChange, options, symbol }: PayCardProps) {
  return (
    <div className="rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-medium text-[11px] text-black/60">You pay</div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <input
          aria-label="Pay amount"
          className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none"
          inputMode="decimal"
          onChange={(event) => onAmountChange(event.target.value)}
          placeholder="0"
          type="text"
          value={amount}
        />
        <AssetSelect
          headerLabel="Select currency"
          onChange={noop}
          options={options}
          value={options[0]?.code ?? ""}
        />
      </div>
      <div className="mt-2 text-black/35 text-xs">{symbol}</div>
    </div>
  );
}

type ReceiveCardProps = {
  amount: string;
  options: AssetOption[];
  symbol: string;
  showRedeemNote: boolean;
};

function ReceiveCard({ amount, options, symbol, showRedeemNote }: ReceiveCardProps) {
  return (
    <div className="mt-3 rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-medium text-[11px] text-black/60">You receive</div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none">
          {amount}
        </div>
        <AssetSelect onChange={noop} options={options} value={options[0]?.code ?? ""} />
      </div>
      {showRedeemNote ? (
        <div className="mt-1 text-black/50 text-xs">Redeems 1:1 for KESm at maturity</div>
      ) : null}
      <div className="mt-1 text-black/35 text-xs">{symbol}</div>
    </div>
  );
}

type PoolSnapshotCardProps = {
  maturityLabel: string;
  poolBaseLabel: string;
  poolFyLabel: string;
  userBaseLabel: string | null;
  userFyLabel: string | null;
  loading: boolean;
  error: Error | null;
  quoteLoading: boolean;
  quoteError: string | null;
};

function PoolSnapshotCard({
  maturityLabel,
  poolBaseLabel,
  poolFyLabel,
  userBaseLabel,
  userFyLabel,
  loading,
  error,
  quoteLoading,
  quoteError,
}: PoolSnapshotCardProps) {
  return (
    <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-black/60 text-xs shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <span>Maturity</span>
        <span className="text-black/80">{maturityLabel}</span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span>Pool balances</span>
        <span className="text-black/80">
          {poolBaseLabel} · {poolFyLabel}
        </span>
      </div>
      {userBaseLabel !== null && userFyLabel !== null ? (
        <div className="mt-2 flex items-center justify-between">
          <span>Your balances</span>
          <span className="text-black/80">
            {userBaseLabel} · {userFyLabel}
          </span>
        </div>
      ) : null}
      {loading ? <div className="mt-2 text-black/40">Loading onchain data…</div> : null}
      {error ? <div className="mt-2 text-red-500">{error.message}</div> : null}
      {quoteLoading ? <div className="mt-2 text-black/40">Updating quote…</div> : null}
      {quoteError ? <div className="mt-2 text-red-500">{quoteError}</div> : null}
    </div>
  );
}

type AprCardProps = {
  showApr: boolean;
  aprText: string;
  slippageInput: string;
  onSlippageChange: (next: string) => void;
};

function AprCard({ showApr, aprText, slippageInput, onSlippageChange }: AprCardProps) {
  return (
    <div className="mt-5 rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <div className="text-black/60 text-sm">{showApr ? "You lock in" : "Implied price"}</div>
        <div className="font-semibold text-lg text-neutral-900">{showApr ? aprText : "—"}</div>
      </div>
      <div className="mt-3 flex items-center justify-between text-black/60 text-xs">
        <span>Slippage</span>
        <div className="flex items-center gap-2">
          <input
            aria-label="Slippage percentage"
            className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1 text-right text-black/70"
            inputMode="decimal"
            onChange={(event) => onSlippageChange(event.target.value)}
            value={slippageInput}
          />
          <span>%</span>
        </div>
      </div>
    </div>
  );
}

export function TradeForm({ className }: TradeFormProps) {
  const [amount, setAmount] = useState("");
  const [slippageInput, setSlippageInput] = useState(() =>
    (Number(DEFAULT_SLIPPAGE_BPS) / 100).toString()
  );
  const [direction, setDirection] = useState<Direction>("BASE_TO_FY");
  const userAddress: Address | undefined = usePrivyAddress();
  const { walletClient } = usePrivyWalletClient();
  const {
    loading,
    error,
    baseToken,
    fyToken,
    poolBaseBalance,
    poolFyBalance,
    maturity,
    baseDecimals,
    fyDecimals,
    baseSymbol,
    fySymbol,
    userBaseBal,
    userFyBal,
    refetch,
  } = usePoolReads(userAddress);
  const { quote, quoteError, quoteLoading } = useQuote(amount, direction, baseDecimals, fyDecimals);
  const parsedSlippage = Number.parseFloat(slippageInput);
  const slippageBps = Number.isFinite(parsedSlippage)
    ? BigInt(Math.min(Math.max(Math.round(parsedSlippage * 100), 0), Number(MAX_SLIPPAGE_BPS)))
    : DEFAULT_SLIPPAGE_BPS;

  const {
    canSwap,
    handleSwap,
    txLoading,
    txError,
    transferTxHash,
    swapTxHash,
    amountInBase,
    amountInFy,
    expectedFyOut,
    minFyOut,
    expectedBaseOut,
    minBaseOut,
    phase,
    isPending,
    hasTraded,
    dimQuoteOnce,
    resetTradeState,
  } = useSwap({
    amount,
    baseDecimals,
    baseToken,
    direction,
    fyDecimals,
    fyToken,
    quoteError,
    quoteLoading,
    refetch,
    slippageBps,
    userAddress,
    walletClient,
  });
  const buttonLabel = getButtonLabel({
    direction,
    hasTraded,
    phase,
    txLoading,
    userAddress,
  });
  const receiveAmount = quote;

  const aprText = useAprText(maturity, poolBaseBalance, poolFyBalance);

  const maturityLabel = getMaturityLabel(maturity);
  const poolBaseLabel = formatTokenAmount(poolBaseBalance, baseDecimals, baseSymbol) ?? "—";
  const poolFyLabel = formatTokenAmount(poolFyBalance, fyDecimals, fySymbol) ?? "—";
  const userBaseLabel = formatTokenAmount(userBaseBal ?? null, baseDecimals, baseSymbol);
  const userFyLabel = formatTokenAmount(userFyBal ?? null, fyDecimals, fySymbol);
  const payOptions = direction === "BASE_TO_FY" ? lendAssetOptions : receiveAssetOptions;
  const receiveOptions = direction === "BASE_TO_FY" ? receiveAssetOptions : lendAssetOptions;
  const paySymbol = direction === "BASE_TO_FY" ? (baseSymbol ?? "KESm") : (fySymbol ?? "fyKESm");
  const receiveSymbol =
    direction === "BASE_TO_FY" ? (fySymbol ?? "fyKESm") : (baseSymbol ?? "KESm");
  const showApr = direction === "BASE_TO_FY";
  const handleToggleDirection = () => {
    setDirection((current) => (current === "BASE_TO_FY" ? "FY_TO_BASE" : "BASE_TO_FY"));
    resetTradeState();
  };

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-[32px] border border-black/5 bg-[#FAFAF8] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <DirectionToggle direction={direction} onToggle={handleToggleDirection} />
      <PayCard amount={amount} onAmountChange={setAmount} options={payOptions} symbol={paySymbol} />
      <ReceiveCard
        amount={receiveAmount}
        options={receiveOptions}
        showRedeemNote={direction === "BASE_TO_FY"}
        symbol={receiveSymbol}
      />
      <PoolSnapshotCard
        error={error}
        loading={loading}
        maturityLabel={maturityLabel}
        poolBaseLabel={poolBaseLabel}
        poolFyLabel={poolFyLabel}
        quoteError={quoteError}
        quoteLoading={quoteLoading}
        userBaseLabel={userBaseLabel}
        userFyLabel={userFyLabel}
      />
      <AprCard
        aprText={aprText}
        onSlippageChange={setSlippageInput}
        showApr={showApr}
        slippageInput={slippageInput}
      />

      <SwapActions
        buttonLabel={buttonLabel}
        canSwap={canSwap}
        isPending={isPending}
        onSwap={handleSwap}
        phase={phase}
        txError={txError}
      />
      {phase === "error" ? (
        <div className="mt-2 text-center">
          <button
            className="rounded-xl border border-black/10 px-3 py-1 text-black/70 text-xs transition-colors hover:bg-black/5"
            onClick={handleSwap}
            type="button"
          >
            Retry swap
          </button>
        </div>
      ) : null}
      <SwapProgress
        amountInBase={amountInBase}
        amountInFy={amountInFy}
        baseDecimals={baseDecimals}
        baseSymbol={baseSymbol}
        dimQuoteOnce={dimQuoteOnce}
        direction={direction}
        expectedBaseOut={expectedBaseOut}
        expectedFyOut={expectedFyOut}
        fyDecimals={fyDecimals}
        fySymbol={fySymbol}
        minBaseOut={minBaseOut}
        minFyOut={minFyOut}
        phase={phase}
        slippageBps={slippageBps}
        swapTxHash={swapTxHash}
        transferTxHash={transferTxHash}
      />

      <div className="mt-3 text-center text-black/50 text-xs">
        Pool{" "}
        <a
          className="text-black/80 underline-offset-2 hover:text-black"
          href={CELO_YIELD_POOL.explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          {shortAddress(CELO_YIELD_POOL.poolAddress)}
        </a>{" "}
        on Celoscan
      </div>

      <p className="mt-4 text-center text-black/50 text-xs">
        By executing a transaction, you accept the User Agreement.
      </p>
    </div>
  );
}
