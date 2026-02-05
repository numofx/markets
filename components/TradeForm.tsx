"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { AssetSelect } from "@/ui/AssetSelect";
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { publicClient } from "@/lib/celoClients";
import { poolAbi } from "@/lib/abi/pool";
import { erc20Abi } from "@/lib/abi/erc20";
import type { Address } from "viem";
import { formatUnits, parseUnits } from "viem";
import { celo } from "viem/chains";

type AssetOption = {
  code: string;
  name: string;
  flagSrc: string;
};

type TradeFormProps = {
  className?: string;
};

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

function formatTokenAmount(
  balance: bigint | null,
  decimals: number | null,
  symbol: string | null
) {
  if (balance === null || decimals === null || !symbol) {
    return null;
  }
  return `${formatUnits(balance, decimals)} ${symbol}`;
}

function getMaturityLabel(maturity: number | null) {
  return maturity === null ? "—" : new Date(maturity * 1000).toLocaleString();
}

function useAprText(maturity: number | null, poolBaseBalance: bigint | null, poolFyBalance: bigint | null) {
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
    address: CELO_YIELD_POOL.poolAddress as Address,
    abi: poolAbi,
    functionName: "sellBasePreview",
    args: [baseIn256],
  });
  return formatNumber(Number.parseFloat(formatUnits(fyOut, fyDecimals)));
}

async function getQuoteResult(
  amount: string,
  baseDecimals: number,
  fyDecimals: number
): Promise<{ quote: string; error: string | null }> {
  try {
    const baseAmount = parseUnits(amount, baseDecimals);
    if (baseAmount > U128_MAX) {
      return { quote: "0", error: "Amount too large for pool preview." };
    }
    const nextQuote = await readFyOut(baseAmount, fyDecimals);
    return { quote: nextQuote, error: null };
  } catch (caught) {
    return {
      quote: "0",
      error: caught instanceof Error ? caught.message : "Failed to quote",
    };
  }
}

function useQuote(amount: string, baseDecimals: number | null, fyDecimals: number | null) {
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
        const result = await getQuoteResult(amount, baseDecimals, fyDecimals);
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
  }, [amount, baseDecimals, fyDecimals]);

  return { quote, quoteError, quoteLoading };
}

type SwapParams = {
  amount: string;
  baseDecimals: number | null;
  fyDecimals: number | null;
  baseToken: Address | null;
  userAddress: Address | undefined;
  walletClient: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]> | null;
  slippageBps: bigint;
  quoteError: string | null;
  quoteLoading: boolean;
  refetch: () => void;
};

function useSwap({
  amount,
  baseDecimals,
  fyDecimals,
  baseToken,
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
  const [expectedFyOut, setExpectedFyOut] = useState<bigint | null>(null);
  const [minFyOut, setMinFyOut] = useState<bigint | null>(null);
  const [hasTraded, setHasTraded] = useState(false);
  const [dimQuoteOnce, setDimQuoteOnce] = useState(false);
  const [phase, setPhase] = useState<
    "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error"
  >("idle");

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

  const transferBaseToPool = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    token: Address,
    requiredAmount: bigint
  ) => {
    setPhase("transfer_sign");
    const transferHash = await waitForWalletConfirmation(
      client.writeContract({
        address: token,
        abi: erc20Abi,
        functionName: "transfer",
        args: [CELO_YIELD_POOL.poolAddress as Address, requiredAmount],
        account: address,
        chain: celo,
      })
    );
    setTransferTxHash(transferHash);
    setPhase("transfer_pending");
    await publicClient.waitForTransactionReceipt({ hash: transferHash });
  };

  const executeSell = async (
    client: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>,
    address: Address,
    minOut: bigint
  ) => {
    setPhase("swap_sign");
    const sellHash = await waitForWalletConfirmation(
      client.writeContract({
        address: CELO_YIELD_POOL.poolAddress as Address,
        abi: poolAbi,
        functionName: "sellBase",
        args: [address, minOut],
        account: address,
        chain: celo,
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
    baseToken !== null &&
    !quoteLoading &&
    quoteError === null &&
    !isPending &&
    !txLoading;

  const getSwapValidationError = () => {
    if (!userAddress) {
      return "Connect a wallet to continue.";
    }
    if (!walletClient) {
      return "Wallet client unavailable.";
    }
    if (baseToken === null || baseDecimals === null || fyDecimals === null) {
      return "Pool data not ready.";
    }
    const parsed = Number.parseFloat(amount);
    if (!amount || Number.isNaN(parsed) || parsed <= 0) {
      return "Enter an amount to swap.";
    }
    return null;
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
    if (!(walletClient && userAddress) || baseToken === null) {
      setTxError("Wallet not ready.");
      return;
    }
    const client = walletClient;
    const address: Address = userAddress;
    const token: Address = baseToken;
    setTxError(null);
    setSwapTxHash(null);
    setPhase("idle");
    setTxLoading(true);

    try {
      const baseIn256 = parseUnits(amount, baseDecimals as number);
      if (baseIn256 > U128_MAX) {
        throw new Error("Amount too large for pool.");
      }
      setAmountInBase(baseIn256);

      const fyOut = await publicClient.readContract({
        address: CELO_YIELD_POOL.poolAddress as Address,
        abi: poolAbi,
        functionName: "sellBasePreview",
        args: [baseIn256],
      });
      const nextMinFyOut = (fyOut * (10_000n - slippageBps)) / 10_000n;
      setExpectedFyOut(fyOut);
      setMinFyOut(nextMinFyOut);

      await transferBaseToPool(client, address, token, baseIn256);
      await executeSell(client, address, nextMinFyOut);
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
    canSwap,
    handleSwap,
    txLoading,
    txError,
    transferTxHash,
    swapTxHash,
    amountInBase,
    expectedFyOut,
    minFyOut,
    phase,
    isPending,
    hasTraded,
    dimQuoteOnce,
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

function getTransferStatus(phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error") {
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

function getSwapStatus(phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error") {
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
  amountInBase: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  expectedFyOut: bigint | null;
  minFyOut: bigint | null;
  slippageBps: bigint;
  fyDecimals: number | null;
  fySymbol: string | null;
  transferTxHash: string | null;
  swapTxHash: string | null;
  phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error";
  dimQuoteOnce: boolean;
};

type SwapActionsProps = {
  canSwap: boolean;
  isPending: boolean;
  phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error";
  buttonLabel: string;
  onSwap: () => void;
  txError: string | null;
};

type SwapMetricsProps = {
  amountInBase: bigint | null;
  baseDecimals: number | null;
  baseSymbol: string | null;
  expectedFyOut: bigint | null;
  minFyOut: bigint | null;
  slippageBps: bigint;
  fyDecimals: number | null;
  fySymbol: string | null;
  dimQuoteOnce: boolean;
};

function SwapMetrics({
  amountInBase,
  baseDecimals,
  baseSymbol,
  expectedFyOut,
  minFyOut,
  slippageBps,
  fyDecimals,
  fySymbol,
  dimQuoteOnce,
}: SwapMetricsProps) {
  const formattedAmountIn =
    amountInBase !== null && baseDecimals !== null
      ? `${formatUnits(amountInBase, baseDecimals)} ${baseSymbol ?? "base"}`
      : "—";
  const formattedExpected =
    expectedFyOut !== null && fyDecimals !== null
      ? `${formatUnits(expectedFyOut, fyDecimals)} ${fySymbol ?? "fyToken"}`
      : "—";
  const formattedMin =
    minFyOut !== null && fyDecimals !== null
      ? `${formatUnits(minFyOut, fyDecimals)} ${fySymbol ?? "fyToken"}`
      : "—";

  return (
    <div className={cn("mt-3 text-black/50", dimQuoteOnce ? "opacity-50" : "")}>
      <div>Amount in: {formattedAmountIn}</div>
      <div>Expected out: {formattedExpected}</div>
      <div>Min out: {formattedMin}</div>
      <div>Slippage: {slippageBps.toString()} bps</div>
      <div className="mt-1 text-[10px] text-black/40">min = expected * (1 - bps/10000)</div>
    </div>
  );
}

type SwapLinksProps = {
  transferTxHash: string | null;
  swapTxHash: string | null;
  phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error";
};

function SwapLinks({ transferTxHash, swapTxHash, phase }: SwapLinksProps) {
  const showTxLinks =
    phase === "transfer_pending" || phase === "swap_pending" || phase === "done";
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

function SwapActions({ canSwap, isPending, phase, buttonLabel, onSwap, txError }: SwapActionsProps) {
  const isDisabled = !canSwap || isPending || phase === "transfer_pending" || phase === "swap_pending";

  return (
    <>
      <div className="mt-5 flex items-center gap-2">
        <button
          className={cn(
            "h-12 flex-1 rounded-2xl px-4 font-semibold text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,0.10)] transition-colors",
            canSwap ? "bg-black/80 hover:bg-black/90" : "cursor-not-allowed bg-black/10 text-black/30 shadow-none"
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

function getButtonLabel(
  phase: "idle" | "transfer_sign" | "transfer_pending" | "swap_sign" | "swap_pending" | "done" | "error",
  userAddress: Address | undefined,
  txLoading: boolean,
  hasTraded: boolean
) {
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
  return "Buy fyKESm";
}

function SwapProgress({
  amountInBase,
  baseDecimals,
  baseSymbol,
  expectedFyOut,
  minFyOut,
  slippageBps,
  fyDecimals,
  fySymbol,
  transferTxHash,
  swapTxHash,
  phase,
  dimQuoteOnce,
}: SwapProgressProps) {
  return (
    <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-black/60 text-xs shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-semibold text-black/70">Progress</div>
      <div className="mt-2">
        <div className="text-black/70">Step 1: Transfer base → pool</div>
        <div className="mt-1 text-black/50">{getTransferStatus(phase)}</div>
      </div>
      <div className="mt-3">
        <div className="text-black/70">Step 2: Swap base → fyToken</div>
        <div className="mt-1 text-black/50">{getSwapStatus(phase)}</div>
      </div>
      <SwapMetrics
        amountInBase={amountInBase}
        baseDecimals={baseDecimals}
        baseSymbol={baseSymbol}
        expectedFyOut={expectedFyOut}
        minFyOut={minFyOut}
        slippageBps={slippageBps}
        fyDecimals={fyDecimals}
        fySymbol={fySymbol}
        dimQuoteOnce={dimQuoteOnce}
      />
      <SwapLinks transferTxHash={transferTxHash} swapTxHash={swapTxHash} phase={phase} />
    </div>
  );
}

export function TradeForm({ className }: TradeFormProps) {
  const [amount, setAmount] = useState("");
  const [slippageInput, setSlippageInput] = useState(
    () => (Number(DEFAULT_SLIPPAGE_BPS) / 100).toString()
  );
  const userAddress: Address | undefined = usePrivyAddress();
  const { walletClient } = usePrivyWalletClient();
  const {
    loading,
    error,
    baseToken,
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
  const { quote, quoteError, quoteLoading } = useQuote(amount, baseDecimals, fyDecimals);
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
    expectedFyOut,
    minFyOut,
    phase,
    isPending,
    hasTraded,
    dimQuoteOnce,
  } = useSwap({
    amount,
    baseDecimals,
    fyDecimals,
    baseToken,
    userAddress,
    walletClient,
    slippageBps,
    quoteError,
    quoteLoading,
    refetch,
  });
  const buttonLabel = getButtonLabel(phase, userAddress, txLoading, hasTraded);
  const [primaryAsset, setPrimaryAsset] = useState<AssetOption["code"]>(
    () => lendAssetOptions[0].code
  );
  const [secondaryAsset, setSecondaryAsset] = useState<AssetOption["code"]>(
    () => receiveAssetOptions[0].code
  );
  const receiveAmount = quote;

  const aprText = useAprText(maturity, poolBaseBalance, poolFyBalance);

  const maturityLabel = getMaturityLabel(maturity);
  const poolBaseLabel = formatTokenAmount(poolBaseBalance, baseDecimals, baseSymbol) ?? "—";
  const poolFyLabel = formatTokenAmount(poolFyBalance, fyDecimals, fySymbol) ?? "—";
  const userBaseLabel = formatTokenAmount(userBaseBal ?? null, baseDecimals, baseSymbol);
  const userFyLabel = formatTokenAmount(userFyBal ?? null, fyDecimals, fySymbol);

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-[32px] border border-black/5 bg-[#FAFAF8] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)]",
        className
      )}
    >
      <div className="rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="font-medium text-[11px] text-black/60">You pay</div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <input
            aria-label="Pay amount"
            className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            type="text"
            value={amount}
          />
          <AssetSelect
            headerLabel="Select currency"
            onChange={setPrimaryAsset}
            options={lendAssetOptions}
            value={primaryAsset}
          />
        </div>
        <div className="mt-2 text-black/35 text-xs">KESm</div>
      </div>

      <div className="mt-3 rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="font-medium text-[11px] text-black/60">You receive</div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none">
            {receiveAmount}
          </div>
          <AssetSelect
            onChange={setSecondaryAsset}
            options={receiveAssetOptions}
            value={secondaryAsset}
          />
        </div>
        <div className="mt-1 text-black/50 text-xs">Redeems 1:1 for KESm at maturity</div>
      </div>

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

      <div className="mt-5 rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <div className="text-black/60 text-sm">You lock in</div>
          <div className="font-semibold text-lg text-neutral-900">{aprText}</div>
        </div>
        <div className="mt-3 flex items-center justify-between text-black/60 text-xs">
          <span>Slippage</span>
          <div className="flex items-center gap-2">
            <input
              aria-label="Slippage percentage"
              className="w-16 rounded-lg border border-black/10 bg-white px-2 py-1 text-right text-black/70"
              inputMode="decimal"
              onChange={(event) => setSlippageInput(event.target.value)}
              value={slippageInput}
            />
            <span>%</span>
          </div>
        </div>
      </div>

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
        baseDecimals={baseDecimals}
        baseSymbol={baseSymbol}
        expectedFyOut={expectedFyOut}
        minFyOut={minFyOut}
        slippageBps={slippageBps}
        fyDecimals={fyDecimals}
        fySymbol={fySymbol}
        transferTxHash={transferTxHash}
        swapTxHash={swapTxHash}
        phase={phase}
        dimQuoteOnce={dimQuoteOnce}
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
