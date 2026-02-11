"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  ExternalLink,
  Wallet,
  Waves,
} from "lucide-react";
import Image from "next/image";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { decodeEventLog, formatUnits, parseUnits } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
import { getRevertSelector } from "@/lib/get-revert-selector";
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type LendFixedRateProps = {
  className?: string;
};

type TokenOption = {
  id: "USDT" | "KESm";
  label: string;
};

type LendStep = "form" | "review" | "confirm";
type LendTxPhase =
  | "idle"
  | "transfer_sign"
  | "transfer_pending"
  | "swap_sign"
  | "swap_pending"
  | "done"
  | "error";

const TOKEN_ICON_SRC = {
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"], string>;

const U128_MAX = BigInt("340282366920938463463374607431768211455");
const DEFAULT_SLIPPAGE_BPS = 50n;
const WALLET_TIMEOUT_MS = 120_000;

function sumErc20TransfersTo(params: {
  logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  tokenAddress: Address;
  to: Address;
}) {
  let total = 0n;
  for (const log of params.logs) {
    if (log.address.toLowerCase() !== params.tokenAddress.toLowerCase()) {
      continue;
    }
    if (log.topics.length === 0) {
      continue;
    }

    try {
      const decoded = decodeEventLog({
        abi: erc20Abi,
        data: log.data,
        topics: [...log.topics] as [Hex, ...Hex[]],
      });
      if (decoded.eventName !== "Transfer") {
        continue;
      }
      const { to, value } = decoded.args as { from: Address; to: Address; value: bigint };
      if (to.toLowerCase() !== params.to.toLowerCase()) {
        continue;
      }
      total += value;
    } catch {
      // Ignore non-ERC20 Transfer logs on this address.
    }
  }

  return total;
}

type MaturityOption = {
  id: string;
  aprText: string;
  dateLabel: string;
  accent: "teal" | "violet" | "lime";
  disabled?: boolean;
  disabledReason?: string;
};

const TOKENS: TokenOption[] = [
  { id: "USDT", label: "USDT" },
  { id: "KESm", label: "KESm" },
];

function formatMaturityDateLabel(maturitySeconds: number) {
  // Match the screenshot style (e.g. "31 Dec 2021"), but always in UTC.
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(maturitySeconds * 1000));
}

function toWad(value: bigint, decimals: number) {
  if (decimals === 18) {
    return value;
  }
  if (decimals < 18) {
    return value * 10n ** BigInt(18 - decimals);
  }
  return value / 10n ** BigInt(decimals - 18);
}

async function fetchLendAprText(params: {
  baseDecimals: number;
  fyDecimals: number;
  poolBaseBalance: bigint;
  poolFyBalance: bigint;
  timeRemaining: bigint;
}) {
  if (params.timeRemaining <= 0n || params.poolFyBalance <= 0n) {
    return { aprText: "—", unavailable: false };
  }

  // Prefer quoting the pool for a small trade size (1 base token) to get a curve-aware spot price.
  try {
    const baseUnit = 10n ** BigInt(params.baseDecimals);
    // Use a tiny amount for a closer-to-spot quote (0.001 base token), matching typical UX expectations.
    const baseIn = baseUnit / 1000n || 1n;
    if (baseIn <= U128_MAX) {
      const fyOut = await publicClient.readContract({
        abi: poolAbi,
        address: CELO_YIELD_POOL.poolAddress as Address,
        args: [baseIn],
        functionName: "sellBasePreview",
      });

      if (fyOut > 0n) {
        const baseInWad = toWad(baseIn, params.baseDecimals);
        const fyOutWad = toWad(fyOut, params.fyDecimals);
        const pWad = (baseInWad * WAD) / fyOutWad;
        return {
          aprText: formatAprPercent(aprFromPriceWad(pWad, params.timeRemaining)),
          unavailable: false,
        };
      }
    }
  } catch (caught) {
    if (formatTxError(caught).includes("0xb24d9e1b")) {
      return { aprText: "—", unavailable: true };
    }
  }

  const pWad =
    (toWad(params.poolBaseBalance, params.baseDecimals) * WAD) /
    toWad(params.poolFyBalance, params.fyDecimals);
  return {
    aprText: formatAprPercent(aprFromPriceWad(pWad, params.timeRemaining)),
    unavailable: false,
  };
}

function useLendMaturityOptions(token: TokenOption["id"]): MaturityOption[] {
  const poolReads = usePoolReads();
  const { baseDecimals, fyDecimals, loading, maturity, poolBaseBalance, poolFyBalance } = poolReads;
  const refetchRef = useRef(poolReads.refetch);

  useEffect(() => {
    refetchRef.current = poolReads.refetch;
  }, [poolReads.refetch]);

  const [options, setOptions] = useState<MaturityOption[]>(() =>
    token === "KESm" ? [{ accent: "lime", aprText: "—", dateLabel: "—", id: "loading" }] : []
  );

  useEffect(() => {
    if (token !== "KESm") {
      setOptions([]);
      return;
    }

    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      refetchRef.current();
    }, 15_000);

    return () => clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    let cancelled = false;

    if (token !== "KESm") {
      setOptions([]);
      return () => {
        cancelled = true;
      };
    }

    if (loading) {
      setOptions([{ accent: "lime", aprText: "—", dateLabel: "—", id: "loading" }]);
      return () => {
        cancelled = true;
      };
    }

    if (
      maturity === null ||
      !Number.isFinite(maturity) ||
      poolBaseBalance === null ||
      poolFyBalance === null ||
      baseDecimals === null ||
      fyDecimals === null
    ) {
      setOptions([{ accent: "lime", aprText: "—", dateLabel: "—", id: "error" }]);
      return () => {
        cancelled = true;
      };
    }

    const maturitySeconds = maturity;
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = BigInt(maturitySeconds) - nowSeconds;

    void (async () => {
      const aprResult = await fetchLendAprText({
        baseDecimals,
        fyDecimals,
        poolBaseBalance,
        poolFyBalance,
        timeRemaining,
      });

      if (cancelled) {
        return;
      }

      setOptions([
        {
          accent: "lime",
          aprText: aprResult.aprText,
          dateLabel: formatMaturityDateLabel(maturitySeconds),
          disabled: aprResult.unavailable,
          disabledReason: aprResult.unavailable
            ? "Pool currently rejects lend trades for this maturity."
            : undefined,
          id: `pool:${maturitySeconds}`,
        },
      ]);
    })();

    return () => {
      cancelled = true;
    };
  }, [baseDecimals, fyDecimals, loading, maturity, poolBaseBalance, poolFyBalance, token]);

  return options;
}

function accentClasses(accent: MaturityOption["accent"]) {
  switch (accent) {
    case "teal":
      return "bg-gray-100 text-black";
    case "violet":
      return "bg-gray-100 text-black";
    case "lime":
      return "bg-gray-100 text-black";
  }
}

function isPositiveAmount(value: string) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0;
}

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

function formatTxError(caught: unknown) {
  const maybeAny = caught as {
    data?: unknown;
    message?: string;
    shortMessage?: string;
    cause?: unknown;
  };

  let baseMessage = "Transaction failed.";
  if (typeof maybeAny?.shortMessage === "string") {
    baseMessage = maybeAny.shortMessage;
  } else if (caught instanceof Error && caught.message) {
    baseMessage = caught.message;
  }

  const selector = getRevertSelector(caught);
  if (!selector) {
    return baseMessage;
  }
  if (selector === "0xb24d9e1b") {
    return `Pool rejected trade: Negative interest rates not allowed. Try a smaller amount. (revert selector: ${selector}, decode: https://4byte.sourcify.dev/?q=${selector})`;
  }
  return `${baseMessage} (revert selector: ${selector}, decode: https://4byte.sourcify.dev/?q=${selector})`;
}

function formatUnitsTruncated(value: bigint, decimals: number, displayDecimals: number) {
  const safeDisplayDecimals = Math.max(0, Math.floor(displayDecimals));
  if (decimals <= safeDisplayDecimals) {
    const raw = formatUnits(value, decimals);
    const [wholePartA, fractionPartA = ""] = raw.split(".");
    return safeDisplayDecimals === 0
      ? wholePartA
      : `${wholePartA}.${fractionPartA
          .padEnd(safeDisplayDecimals, "0")
          .slice(0, safeDisplayDecimals)}`;
  }

  // Truncate (floor) at the bigint level to avoid rounding up in the UI.
  const factor = 10n ** BigInt(decimals - safeDisplayDecimals);
  const truncated = value / factor;
  const raw = formatUnits(truncated, safeDisplayDecimals);
  const [wholePartB, fractionPartB = ""] = raw.split(".");
  return safeDisplayDecimals === 0
    ? wholePartB
    : `${wholePartB}.${fractionPartB
        .padEnd(safeDisplayDecimals, "0")
        .slice(0, safeDisplayDecimals)}`;
}

async function handleLendClick(params: {
  amount: string;
  baseDecimals: number | null;
  baseToken: Address | null;
  canContinue: boolean;
  isCelo: boolean;
  tokenId: TokenOption["id"];
  userAddress: Address | undefined;
  walletClient: ReturnType<typeof usePrivyWalletClient>["walletClient"];
  refetchPoolReads: () => void;
  fyToken: Address | null;
  onConfirmedFyBalance: (balance: bigint) => void;
  onResetConfirmedFyBalance: () => void;
  onConfirmedFyReceived: (received: bigint) => void;
  onResetConfirmedFyReceived: () => void;
  setStep: Dispatch<SetStateAction<LendStep>>;
  setSwapTxHash: Dispatch<SetStateAction<Hex | null>>;
  setTxError: Dispatch<SetStateAction<string | null>>;
  setTxPhase: Dispatch<SetStateAction<LendTxPhase>>;
}) {
  params.setTxError(null);
  params.onResetConfirmedFyBalance();
  params.onResetConfirmedFyReceived();
  params.setSwapTxHash(null);

  try {
    const result = getLendValidationContext({
      amount: params.amount,
      baseDecimals: params.baseDecimals,
      baseToken: params.baseToken,
      canContinue: params.canContinue,
      isCelo: params.isCelo,
      tokenId: params.tokenId,
      userAddress: params.userAddress,
      walletClient: params.walletClient,
    });
    if ("error" in result) {
      params.setTxError(result.error);
      params.setTxPhase("error");
      return;
    }

    params.setStep("confirm");
    params.setTxPhase("idle");

    const receipt = await executeLendBaseToFy({
      account: result.context.account,
      amountInBase: result.context.amountInBase,
      baseToken: result.context.baseToken,
      onPhase: params.setTxPhase,
      walletClient: result.context.walletClient,
    });
    params.setSwapTxHash(receipt.swapHash);
    params.refetchPoolReads();
    if (params.fyToken) {
      try {
        const received = sumErc20TransfersTo({
          logs: receipt.swapReceiptLogs,
          to: result.context.account,
          tokenAddress: params.fyToken,
        });
        params.onConfirmedFyReceived(received);

        const nextFyBal = await publicClient.readContract({
          abi: erc20Abi,
          address: params.fyToken,
          args: [result.context.account],
          blockNumber: receipt.swapBlockNumber,
          functionName: "balanceOf",
        });
        params.onConfirmedFyBalance(nextFyBal);
      } catch {
        // Ignore. We'll fall back to the cached refetch.
      }
    }
    params.setTxPhase("done");
  } catch (caught) {
    params.setTxError(formatTxError(caught));
    params.setTxPhase("error");
  }
}

function useCloseMenuOnEscapeAndOutsideClick(params: {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!params.open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      params.onClose();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (params.containerRef.current?.contains(target)) {
        return;
      }
      params.onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [params]);
}

function useDefaultMaturitySelection(params: {
  maturityOptions: MaturityOption[];
  selectedMaturityId: string;
  setSelectedMaturityId: Dispatch<SetStateAction<string>>;
}) {
  useEffect(() => {
    const nextDefault = params.maturityOptions[0]?.id ?? "";
    if (!nextDefault) {
      params.setSelectedMaturityId("");
      return;
    }

    // If we were on a placeholder selection, advance to the real pool maturity once loaded.
    if (
      !params.selectedMaturityId ||
      params.selectedMaturityId === "loading" ||
      params.selectedMaturityId === "error"
    ) {
      params.setSelectedMaturityId(nextDefault);
      return;
    }

    // If the user selected something that no longer exists (e.g. token switch), reset to the default.
    if (!params.maturityOptions.some((option) => option.id === params.selectedMaturityId)) {
      params.setSelectedMaturityId(nextDefault);
    }
  }, [params]);
}

type LendValidationContext = {
  account: Address;
  amountInBase: bigint;
  baseDecimals: number;
  baseToken: Address;
  walletClient: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;
};

function getLendValidationContext(params: {
  amount: string;
  baseDecimals: number | null;
  baseToken: Address | null;
  canContinue: boolean;
  isCelo: boolean;
  tokenId: TokenOption["id"];
  userAddress: Address | undefined;
  walletClient: ReturnType<typeof usePrivyWalletClient>["walletClient"];
}): { context: LendValidationContext } | { error: string } {
  if (!(params.userAddress && params.walletClient)) {
    return { error: "Connect a wallet to continue." };
  }
  if (!params.isCelo) {
    return { error: "Please switch your wallet to the Celo network." };
  }
  if (!params.canContinue) {
    return { error: "Enter an amount and select a maturity." };
  }
  if (params.tokenId !== "KESm") {
    return { error: "Lending USDT is not supported yet." };
  }
  if (params.baseDecimals === null || params.baseToken === null) {
    return { error: "Pool data not ready." };
  }

  let amountInBase: bigint;
  try {
    amountInBase = parseUnits(params.amount, params.baseDecimals);
  } catch {
    return { error: "Invalid amount." };
  }

  if (amountInBase <= 0n) {
    return { error: "Enter an amount to lend." };
  }
  if (amountInBase > U128_MAX) {
    return { error: "Amount too large for pool." };
  }

  return {
    context: {
      account: params.userAddress,
      amountInBase,
      baseDecimals: params.baseDecimals,
      baseToken: params.baseToken,
      walletClient: params.walletClient,
    },
  };
}

async function executeLendBaseToFy(params: {
  account: Address;
  amountInBase: bigint;
  baseToken: Address;
  onPhase: (phase: LendTxPhase) => void;
  walletClient: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;
}): Promise<{
  swapBlockNumber: bigint;
  swapHash: Hex;
  swapReceiptLogs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  transferHash: Hex;
}> {
  // Preflight quote: if this reverts (eg NegativeInterestRatesNotAllowed), we abort before wallet prompts.
  const fyOut = await publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [params.amountInBase],
    functionName: "sellBasePreview",
  });
  const minFyOut = (fyOut * (10_000n - DEFAULT_SLIPPAGE_BPS)) / 10_000n;

  params.onPhase("transfer_sign");

  const transferHash = await withTimeout(
    params.walletClient.writeContract({
      abi: erc20Abi,
      account: params.account,
      address: params.baseToken,
      args: [CELO_YIELD_POOL.poolAddress as Address, params.amountInBase],
      chain: celo,
      functionName: "transfer",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );

  params.onPhase("transfer_pending");
  await publicClient.waitForTransactionReceipt({ hash: transferHash });

  params.onPhase("swap_sign");
  const swapHash = await withTimeout(
    params.walletClient.writeContract({
      abi: poolAbi,
      account: params.account,
      address: CELO_YIELD_POOL.poolAddress as Address,
      args: [params.account, minFyOut],
      chain: celo,
      functionName: "sellBase",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );

  params.onPhase("swap_pending");
  const swapReceipt = await publicClient.waitForTransactionReceipt({ hash: swapHash });

  return {
    swapBlockNumber: swapReceipt.blockNumber,
    swapHash,
    swapReceiptLogs: swapReceipt.logs as unknown as readonly {
      address: Address;
      data: Hex;
      topics: readonly Hex[];
    }[],
    transferHash,
  };
}

function computeRedeemableAtMaturity(params: {
  amount: string;
  baseDecimals: number | null;
  poolBaseBalance: bigint | null;
  poolFyBalance: bigint | null;
  tokenId: TokenOption["id"];
  tokenLabel: string;
  maturityOption: MaturityOption | undefined;
}) {
  if (params.tokenId !== "KESm") {
    return null;
  }
  if (
    !params.maturityOption ||
    params.maturityOption.id === "loading" ||
    params.maturityOption.id === "error"
  ) {
    return null;
  }
  if (
    params.baseDecimals === null ||
    params.poolBaseBalance === null ||
    params.poolFyBalance === null ||
    params.poolFyBalance <= 0n
  ) {
    return null;
  }

  const numeric = Number.parseFloat(params.amount);
  if (!params.amount || Number.isNaN(numeric) || numeric <= 0) {
    return null;
  }

  try {
    // Price in base per fy (WAD). Redeemable base at maturity is base / price.
    const pWad = (params.poolBaseBalance * WAD) / params.poolFyBalance;
    if (pWad <= 0n) {
      return null;
    }
    const amountBase = parseUnits(params.amount, params.baseDecimals);
    const redeemableBase = (amountBase * WAD) / pWad;
    return `${formatUnitsTruncated(redeemableBase, params.baseDecimals, 2)} ${params.tokenLabel}`;
  } catch {
    return null;
  }
}

function TokenIcon({ tokenId }: { tokenId: TokenOption["id"] }) {
  return (
    <span className="inline-flex rounded-full bg-gray-200 p-0.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
        <Image alt={`${tokenId} token icon`} height={20} src={TOKEN_ICON_SRC[tokenId]} width={20} />
      </span>
    </span>
  );
}

function LendFormView(props: {
  amount: string;
  canContinue: boolean;
  className?: string;
  maturityOptions: MaturityOption[];
  onAmountChange: (next: string) => void;
  onMaturitySelect: (id: string) => void;
  onNextStep: () => void;
  onTokenSelect: (id: TokenOption["id"]) => void;
  selectedMaturityId: string;
  selectedToken: TokenOption;
  token: TokenOption["id"];
}) {
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);

  useCloseMenuOnEscapeAndOutsideClick({
    containerRef: tokenMenuRef,
    onClose: () => setTokenMenuOpen(false),
    open: tokenMenuOpen,
  });

  return (
    <div className={cn("w-full", props.className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn("-inset-10 absolute rounded-3xl opacity-70 blur-3xl", "bg-neutral-200/60")}
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          <header>
            <h2 className="font-semibold text-3xl text-black">Lend</h2>
            <p className="mt-1 text-gray-500 text-sm">Lend stablecoins for predictable returns</p>
          </header>

          <div className="mt-8 flex items-center gap-3">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor="lend-amount">
                Amount
              </label>
              <input
                className={cn(
                  "h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 pr-14 text-black shadow-sm outline-none",
                  "placeholder:text-gray-400 focus:border-black focus:ring-1 focus:ring-black"
                )}
                id="lend-amount"
                inputMode="decimal"
                onChange={(event) => props.onAmountChange(event.target.value)}
                placeholder="Enter amount"
                value={props.amount}
              />
              <button
                className="-translate-y-1/2 absolute top-1/2 right-3 rounded-full bg-gray-100 px-2 py-1 font-semibold text-black text-xs transition hover:bg-gray-200"
                onClick={() => props.onAmountChange("0")}
                type="button"
              >
                Max
              </button>
            </div>

            <div className="relative" ref={tokenMenuRef}>
              <button
                aria-expanded={tokenMenuOpen}
                aria-haspopup="menu"
                className={cn(
                  "flex h-12 w-44 items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-white px-3 text-black shadow-sm",
                  "transition hover:bg-numo-pill/50"
                )}
                onClick={() => setTokenMenuOpen((value) => !value)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <TokenIcon tokenId={props.selectedToken.id} />
                  <span className="font-semibold text-sm">{props.selectedToken.label}</span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-numo-muted transition-transform",
                    tokenMenuOpen ? "rotate-180" : "rotate-0"
                  )}
                />
              </button>

              {tokenMenuOpen ? (
                <div className="absolute right-0 z-10 mt-3 w-80 rounded-3xl border border-numo-border bg-white p-3 shadow-xl">
                  <div className="px-3 py-2 font-semibold text-numo-muted text-xs tracking-wide">
                    SELECT STABLECOIN
                  </div>
                  {TOKENS.map((option) => {
                    const isSelected = option.id === props.token;
                    return (
                      <button
                        className={cn(
                          "flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-numo-pill/60",
                          isSelected ? "bg-numo-pill" : "bg-transparent"
                        )}
                        key={option.id}
                        onClick={() => {
                          props.onTokenSelect(option.id);
                          setTokenMenuOpen(false);
                        }}
                        type="button"
                      >
                        <span className="flex items-center gap-3">
                          <TokenIcon tokenId={option.id} />
                          <span className="font-semibold text-numo-ink text-sm">
                            {option.label}
                          </span>
                        </span>
                        {isSelected ? <Check className="h-5 w-5 text-black" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-10">
            <div className="text-gray-500 text-xs">
              Select a {props.selectedToken.label}-based maturity date
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              {props.maturityOptions.length === 0 ? (
                <div className="col-span-2 rounded-2xl border border-numo-border bg-white px-4 py-4 text-gray-500 text-sm shadow-sm">
                  No maturity dates available for {props.selectedToken.label} yet.
                </div>
              ) : null}
              {props.maturityOptions.map((option) => {
                const isSelected = option.id === props.selectedMaturityId;
                const accent = accentClasses(option.accent);
                const isDisabled =
                  Boolean(option.disabled) || option.id === "loading" || option.id === "error";
                return (
                  <button
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border border-numo-border bg-white px-4 py-4 text-left shadow-sm transition",
                      props.maturityOptions.length === 1 ? "col-span-2" : "col-span-1",
                      isSelected ? "border-black ring-1 ring-black/10" : "",
                      isDisabled ? "opacity-60" : "hover:bg-numo-pill/60"
                    )}
                    disabled={isDisabled}
                    key={option.id}
                    onClick={() => props.onMaturitySelect(option.id)}
                    type="button"
                  >
                    <span
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-full",
                        accent
                      )}
                    >
                      <Waves className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-black text-sm">
                        {option.aprText} <span className="font-medium text-gray-600">APR</span>
                      </div>
                      <div className="mt-1 text-gray-500 text-xs">
                        {option.dateLabel}
                        {option.disabledReason ? ` · ${option.disabledReason}` : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            className={cn(
              "mt-10 h-12 w-full rounded-2xl border font-semibold text-sm shadow-sm transition",
              props.canContinue
                ? "border-black bg-black text-white hover:bg-neutral-800"
                : "border-gray-200 bg-gray-200 text-gray-500"
            )}
            disabled={!props.canContinue}
            onClick={props.onNextStep}
            type="button"
          >
            Next Step
          </button>
        </div>
      </div>
    </div>
  );
}

function LendReviewTransaction(props: {
  amount: string;
  canContinue: boolean;
  className?: string;
  maturityLabel: string;
  onConfirm: () => void;
  onBack: () => void;
  redeemableAtMaturity: string | null;
  tokenLabel: string;
  yieldLabel: string;
}) {
  return (
    <div className={cn("w-full", props.className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn("-inset-10 absolute rounded-3xl opacity-80 blur-3xl", "bg-neutral-200/60")}
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          <button
            aria-label="Back"
            className="mb-6 inline-flex h-10 w-10 items-center justify-center rounded-full text-numo-muted transition hover:bg-numo-pill/60 hover:text-numo-ink"
            onClick={props.onBack}
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          <header>
            <h2 className="font-semibold text-numo-ink text-xl">Review Transaction</h2>
          </header>

          <div className="mt-6 rounded-3xl border border-numo-border/70 bg-white/70 p-6 shadow-sm">
            <div className="grid grid-cols-[20px_1fr] gap-x-4 gap-y-6">
              <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-numo-border text-numo-muted text-xs">
                +
              </span>
              <div>
                <div className="text-numo-muted text-xs">Amount to lend</div>
                <div className="mt-1 font-semibold text-lg text-numo-ink">
                  {props.amount || "—"} {props.tokenLabel}
                </div>
              </div>

              <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-numo-border text-numo-muted text-xs">
                ⏱
              </span>
              <div>
                <div className="text-numo-muted text-xs">Series Maturity</div>
                <div className="mt-1 font-semibold text-lg text-numo-ink">
                  {props.maturityLabel || "—"}
                </div>
              </div>

              <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-numo-border text-numo-muted text-xs">
                ↗
              </span>
              <div>
                <div className="text-numo-muted text-xs">Redeemable at maturity</div>
                <div className="mt-1 font-semibold text-lg text-numo-ink">
                  {props.redeemableAtMaturity ?? "—"}
                </div>
              </div>

              <span className="mt-1 flex h-5 w-5 items-center justify-center rounded-full border border-numo-border text-numo-muted text-xs">
                %
              </span>
              <div>
                <div className="text-numo-muted text-xs">Effective APR</div>
                <div className="mt-1 font-semibold text-lg text-numo-ink">
                  {props.yieldLabel || "—"}
                </div>
              </div>
            </div>
          </div>

          <button
            className={cn(
              "mt-10 h-12 w-full rounded-2xl border font-semibold text-sm shadow-sm transition",
              props.canContinue
                ? "border-black bg-black text-white hover:bg-neutral-800"
                : "border-gray-200 bg-gray-200 text-gray-500"
            )}
            disabled={!props.canContinue}
            onClick={props.onConfirm}
            type="button"
          >
            Lend {props.amount || "—"} {props.tokenLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function getTxStatusLabel(phase: LendTxPhase) {
  if (phase === "transfer_sign") {
    return "Waiting for transfer signature…";
  }
  if (phase === "transfer_pending") {
    return "Transfer pending…";
  }
  if (phase === "swap_sign") {
    return "Waiting for swap signature…";
  }
  if (phase === "swap_pending") {
    return "Swap pending…";
  }
  if (phase === "done") {
    return "Lending confirmed";
  }
  if (phase === "error") {
    return "Lending failed";
  }
  return "Idle";
}

function LendTransactionConfirmation(props: {
  amount: string;
  className?: string;
  onBack: () => void;
  onReset: () => void;
  positionLabel: string | null;
  positionDeltaLabel: string | null;
  positionMaturityLabel: string;
  phase: LendTxPhase;
  swapTxHash: Hex | null;
  tokenLabel: string;
  txError: string | null;
}) {
  const isPending =
    props.phase === "transfer_sign" ||
    props.phase === "transfer_pending" ||
    props.phase === "swap_sign" ||
    props.phase === "swap_pending";

  const title = (() => {
    if (props.phase === "done") {
      return "Transaction Confirmed";
    }
    if (props.phase === "error") {
      return "Transaction Failed";
    }
    return "Transaction Confirmation…";
  })();

  const bodyText =
    props.phase === "error"
      ? (props.txError ?? "Please try again.")
      : "Please check your wallet/provider.";

  const buttonClass = (() => {
    if (isPending) {
      return "border-gray-200 bg-gray-200 text-gray-500";
    }
    if (props.phase === "done") {
      return "border-black bg-black text-white hover:bg-neutral-800";
    }
    return "border-gray-200 bg-gray-200 text-gray-500";
  })();

  return (
    <div className={cn("w-full", props.className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn("-inset-10 absolute rounded-3xl opacity-80 blur-3xl", "bg-neutral-200/60")}
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          <button
            aria-label="Back"
            className={cn(
              "mb-6 inline-flex h-10 w-10 items-center justify-center rounded-full text-numo-muted transition hover:bg-numo-pill/60 hover:text-numo-ink",
              isPending ? "pointer-events-none opacity-40" : ""
            )}
            onClick={props.onBack}
            type="button"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>

          {props.phase === "done" ? (
            <>
              <div className="rounded-3xl border border-numo-border/70 bg-white/70 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                    <CheckCircle2 className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-lg text-numo-ink">Transaction Complete</div>
                    {props.swapTxHash ? (
                      <a
                        className="mt-2 inline-flex items-center gap-1 text-numo-muted text-xs underline-offset-2 hover:text-numo-ink hover:underline"
                        href={`https://celoscan.io/tx/${props.swapTxHash}`}
                        rel="noreferrer"
                        target="_blank"
                      >
                        View on Celoscan <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="mt-8 text-numo-muted text-xs">View position:</div>
              <div className="mt-2 rounded-2xl border border-numo-border bg-white px-4 py-4 shadow-sm">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-numo-border bg-numo-accent/10">
                      <Image
                        alt={props.tokenLabel}
                        className="h-full w-full object-cover"
                        height={28}
                        src="/assets/KESm (Mento Kenyan Shilling).svg"
                        width={28}
                      />
                    </span>
                    <div className="font-semibold text-numo-ink text-sm">
                      {props.positionMaturityLabel}
                    </div>
                  </div>
                  <div className="text-numo-muted text-xs">
                    Balance:{" "}
                    <span className="font-medium text-numo-ink">{props.positionLabel ?? "—"}</span>
                    {props.positionDeltaLabel ? (
                      <span className="ml-2 font-medium text-emerald-700">
                        (+{props.positionDeltaLabel})
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <button
                className={cn(
                  "mt-10 h-12 w-full rounded-2xl border border-numo-border bg-white font-semibold text-numo-ink text-sm shadow-sm transition",
                  "hover:bg-numo-pill/60"
                )}
                onClick={props.onReset}
                type="button"
              >
                Lend some more
              </button>
            </>
          ) : (
            <>
              <div className="rounded-3xl border border-numo-border/70 bg-white/70 p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <span className="mt-0.5 inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-numo-pill text-numo-ink">
                    <Wallet className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold text-lg text-numo-ink">{title}</div>
                    <div className="mt-1 text-numo-muted text-sm">{bodyText}</div>
                    <div className="mt-3 text-numo-muted text-xs">
                      {getTxStatusLabel(props.phase)}
                    </div>
                  </div>
                </div>
              </div>

              <button
                className={cn(
                  "mt-10 h-12 w-full rounded-2xl border border-numo-border font-semibold text-sm shadow-sm transition",
                  buttonClass
                )}
                disabled
                type="button"
              >
                Lending {props.amount || "—"} {props.tokenLabel}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LendConfirmStep(props: {
  amount: string;
  className?: string;
  confirmedFyBalance: bigint | null;
  confirmedFyReceived: bigint | null;
  fyDecimals: number | null;
  fySymbol: string | null;
  onBack: () => void;
  onReset: () => void;
  positionMaturityLabel: string;
  swapTxHash: Hex | null;
  tokenLabel: string;
  txError: string | null;
  txPhase: LendTxPhase;
  userFyBal: bigint | null | undefined;
}) {
  const fyBalanceForUi = props.confirmedFyBalance ?? props.userFyBal ?? null;
  const positionLabel =
    fyBalanceForUi !== null && props.fyDecimals !== null
      ? `${formatUnitsTruncated(fyBalanceForUi, props.fyDecimals, 2)} ${props.fySymbol ?? "fyToken"}`
      : null;
  const positionDeltaLabel =
    props.confirmedFyReceived !== null && props.fyDecimals !== null
      ? `${formatUnitsTruncated(props.confirmedFyReceived, props.fyDecimals, 2)} ${props.fySymbol ?? "fyToken"}`
      : null;

  return (
    <LendTransactionConfirmation
      amount={props.amount}
      className={props.className}
      onBack={props.onBack}
      onReset={props.onReset}
      phase={props.txPhase}
      positionDeltaLabel={positionDeltaLabel}
      positionLabel={positionLabel}
      positionMaturityLabel={props.positionMaturityLabel}
      swapTxHash={props.swapTxHash}
      tokenLabel={props.tokenLabel}
      txError={props.txError}
    />
  );
}

export function LendFixedRate({ className }: LendFixedRateProps) {
  const userAddress = usePrivyAddress();
  const {
    baseDecimals,
    baseToken,
    fyToken,
    fyDecimals,
    fySymbol,
    poolBaseBalance,
    poolFyBalance,
    refetch,
    userFyBal,
  } = usePoolReads(userAddress);
  const { isCelo, walletClient } = usePrivyWalletClient();
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("KESm");
  const maturityOptions = useLendMaturityOptions(token);
  const [step, setStep] = useState<LendStep>("form");
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(
    maturityOptions[0]?.id ?? ""
  );
  const [txPhase, setTxPhase] = useState<LendTxPhase>("idle");
  const [txError, setTxError] = useState<string | null>(null);
  const [swapTxHash, setSwapTxHash] = useState<Hex | null>(null);
  const [confirmedFyBalance, setConfirmedFyBalance] = useState<bigint | null>(null);
  const [confirmedFyReceived, setConfirmedFyReceived] = useState<bigint | null>(null);

  useDefaultMaturitySelection({
    maturityOptions,
    selectedMaturityId,
    setSelectedMaturityId,
  });

  const selectedMaturity =
    maturityOptions.find((option) => option.id === selectedMaturityId) ?? maturityOptions[0];

  const canContinue =
    token === "KESm" &&
    isPositiveAmount(amount) &&
    Boolean(selectedMaturity?.id) &&
    selectedMaturity?.id !== "loading" &&
    selectedMaturity?.id !== "error" &&
    !selectedMaturity?.disabled;
  const selectedToken = TOKENS.find((t) => t.id === token) ?? TOKENS[0];

  const redeemableAtMaturity = computeRedeemableAtMaturity({
    amount,
    baseDecimals,
    maturityOption: selectedMaturity,
    poolBaseBalance,
    poolFyBalance,
    tokenId: token,
    tokenLabel: selectedToken.label,
  });

  const onLendConfirm = () => {
    void handleLendClick({
      amount,
      baseDecimals,
      baseToken,
      canContinue,
      fyToken: fyToken ?? null,
      isCelo,
      onConfirmedFyBalance: (balance) => setConfirmedFyBalance(balance),
      onConfirmedFyReceived: (received) => setConfirmedFyReceived(received),
      onResetConfirmedFyBalance: () => setConfirmedFyBalance(null),
      onResetConfirmedFyReceived: () => setConfirmedFyReceived(null),
      refetchPoolReads: refetch,
      setStep,
      setSwapTxHash,
      setTxError,
      setTxPhase,
      tokenId: token,
      userAddress,
      walletClient,
    });
  };

  if (step === "confirm") {
    return (
      <LendConfirmStep
        amount={amount}
        className={className}
        confirmedFyBalance={confirmedFyBalance}
        confirmedFyReceived={confirmedFyReceived}
        fyDecimals={fyDecimals}
        fySymbol={fySymbol}
        onBack={() => {
          if (txPhase === "done" || txPhase === "error" || txPhase === "idle") {
            setStep("review");
          }
        }}
        onReset={() => {
          setAmount("");
          setConfirmedFyBalance(null);
          setConfirmedFyReceived(null);
          setSwapTxHash(null);
          setTxError(null);
          setTxPhase("idle");
          setStep("form");
        }}
        positionMaturityLabel={selectedMaturity?.dateLabel ?? "—"}
        swapTxHash={swapTxHash}
        tokenLabel={selectedToken.label}
        txError={txError}
        txPhase={txPhase}
        userFyBal={userFyBal}
      />
    );
  }

  if (step === "review") {
    return (
      <LendReviewTransaction
        amount={amount}
        canContinue={canContinue}
        className={className}
        maturityLabel={selectedMaturity?.dateLabel ?? "—"}
        onBack={() => setStep("form")}
        onConfirm={onLendConfirm}
        redeemableAtMaturity={redeemableAtMaturity}
        tokenLabel={selectedToken.label}
        yieldLabel={selectedMaturity?.aprText ?? "—"}
      />
    );
  }

  return (
    <LendFormView
      amount={amount}
      canContinue={canContinue}
      className={className}
      maturityOptions={maturityOptions}
      onAmountChange={setAmount}
      onMaturitySelect={setSelectedMaturityId}
      onNextStep={() => {
        if (!canContinue) {
          return;
        }
        setStep("review");
      }}
      onTokenSelect={setToken}
      selectedMaturityId={selectedMaturityId}
      selectedToken={selectedToken}
      token={token}
    />
  );
}
