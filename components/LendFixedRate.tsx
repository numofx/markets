"use client";

import { ArrowLeft, CheckCircle2, ChevronDown, ExternalLink, Wallet, Waves } from "lucide-react";
import Image from "next/image";
import type { Dispatch, RefObject, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex } from "viem";
import { decodeEventLog, formatUnits, parseUnits } from "viem";
import { base, celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient as basePublicClient } from "@/lib/baseClients";
import { publicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
import { getRevertSelector } from "@/lib/get-revert-selector";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { BASE_CNGN_POOL, CELO_YIELD_POOL } from "@/src/poolInfo";

type AnyPublicClient = typeof publicClient | typeof basePublicClient;

type LendFixedRateProps = {
  className?: string;
  selectedChain: number | null;
};

type TokenOption = {
  id: "USDT" | "USDC" | "USDC_ARB" | "cNGN" | "BRZ" | "MXNB" | "KESm";
  chainId: number;
  label: string;
  name: string;
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
  BRZ: "/assets/brz.svg",
  cNGN: "/assets/cngn.png",
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  MXNB: "/assets/mxnb.png",
  USDC: "/assets/usdc.svg",
  USDC_ARB: "/assets/usdc.svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"], string>;

const U128_MAX = BigInt("340282366920938463463374607431768211455");
const DEFAULT_SLIPPAGE_BPS = 50n;
const WALLET_TIMEOUT_MS = 120_000;
const MAX_REASONABLE_APR_WAD = 10n * WAD; // 1000%

function formatRpcError(caught: unknown) {
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  if (message.includes("Status: 429") || message.includes("HTTP request failed. Status: 429")) {
    return "RPC rate limited (HTTP 429). Set NEXT_PUBLIC_BASE_RPC_URL to a dedicated Base RPC.";
  }
  if (message.includes("HTTP request failed")) {
    return "RPC request failed. Try again or switch RPC.";
  }
  return message || "RPC request failed.";
}

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
  { chainId: 42_220, id: "USDT", label: "USDT", name: "Tether USD" },
  { chainId: 8453, id: "USDC", label: "USDC", name: "Circle USD" },
  { chainId: 42_161, id: "USDC_ARB", label: "USDC", name: "Circle USD" },
  { chainId: 8453, id: "cNGN", label: "cNGN", name: "WrappedCBDC NGN" },
  { chainId: 8453, id: "BRZ", label: "BRZ", name: "Transfero BRL" },
  { chainId: 42_161, id: "MXNB", label: "MXNB", name: "Bitso MXN" },
  { chainId: 42_220, id: "KESm", label: "KESm", name: "Mento KES" },
];
const CHAIN_LABELS: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  42220: "Celo",
};
const TOKEN_ADDRESS_LABEL: Record<TokenOption["id"], string> = {
  BRZ: "0xE918...61B4",
  cNGN: "0xC930...62D3",
  KESm: "0x456a...B0d0",
  MXNB: "0xF197...80aA",
  USDC: "0x8335...2913",
  USDC_ARB: "0xaf88...5831",
  USDT: "0x4806...3D5e",
};

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
  previewSellBase: (baseIn: bigint) => Promise<bigint>;
  baseDecimals: number;
  fyDecimals: number;
  poolBaseCached: bigint;
  poolFyCachedVirtual: bigint;
  realFyCached: bigint;
  timeRemaining: bigint;
}) {
  // If there is no "real" fy in cache (virtual == supply), the pool cannot quote lend trades.
  if (params.timeRemaining <= 0n || params.realFyCached <= 0n) {
    return { aprText: "—", unavailable: true };
  }

  const reservePWad =
    (toWad(params.poolBaseCached, params.baseDecimals) * WAD) /
    toWad(params.poolFyCachedVirtual, params.fyDecimals);
  let pricePWad = reservePWad;

  // Prefer quoting the pool for a small trade size (1 base token) to get a curve-aware spot price.
  try {
    const baseUnit = 10n ** BigInt(params.baseDecimals);
    // Use a tiny amount for a closer-to-spot quote (0.001 base token), matching typical UX expectations.
    const baseIn = baseUnit / 1000n || 1n;
    if (baseIn <= U128_MAX) {
      const fyOut = await params.previewSellBase(baseIn);

      if (fyOut > 0n) {
        const previewPWad =
          (toWad(baseIn, params.baseDecimals) * WAD) / toWad(fyOut, params.fyDecimals);
        const lower = reservePWad / 4n;
        const upper = reservePWad * 4n;
        if (previewPWad >= lower && previewPWad <= upper) {
          pricePWad = previewPWad;
        }
      }
    }
  } catch (_caught) {
    // Some valid pool states (especially thin liquidity / rounding edges) can revert on preview.
    // For the maturity card, fall back to reserve-implied APR instead of hard-disabling the market.
  }

  const aprWad = aprFromPriceWad(pricePWad, params.timeRemaining);
  if (aprWad !== null && aprWad > MAX_REASONABLE_APR_WAD) {
    return { aprText: "—", unavailable: false };
  }
  return {
    aprText: formatAprPercent(aprWad),
    unavailable: false,
  };
}

function getLendPoolConfig(token: TokenOption["id"]) {
  if (token === "cNGN") {
    return {
      chain: base,
      chainId: base.id,
      client: basePublicClient,
      poolAddress: BASE_CNGN_POOL.poolAddress as Address,
    };
  }
  return {
    chain: celo,
    chainId: celo.id,
    client: publicClient,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
  };
}

type UseLendPoolReadsResult = {
  loading: boolean;
  error: Error | null;
  baseToken: Address | null;
  fyToken: Address | null;
  poolBaseBalance: bigint | null;
  poolFyBalance: bigint | null;
  maturity: number | null;
  baseDecimals: number | null;
  fyDecimals: number | null;
  fySymbol: string | null;
  userFyBal: bigint | null;
  refetch: () => void;
};

async function readLendPoolSnapshot(params: {
  tokenId: TokenOption["id"];
  userAddress?: Address;
}): Promise<{
  baseToken: Address;
  fyToken: Address;
  baseBalance: bigint;
  fyBalance: bigint;
  maturity: number;
  baseDecimals: number;
  fyDecimals: number;
  fySymbol: string;
  userFyBal: bigint | null;
}> {
  const { client, poolAddress } = getLendPoolConfig(params.tokenId);

  const [baseToken, fyToken, maturity, baseBalance, fyBalance] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: poolAddress, functionName: "baseToken" },
      { abi: poolAbi, address: poolAddress, functionName: "fyToken" },
      { abi: poolAbi, address: poolAddress, functionName: "maturity" },
      { abi: poolAbi, address: poolAddress, functionName: "getBaseBalance" },
      { abi: poolAbi, address: poolAddress, functionName: "getFYTokenBalance" },
    ],
  });

  const [baseDecimalsRaw, fySymbol, fyDecimalsRaw] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "symbol" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
    ],
  });

  let userFyBal: bigint | null = null;
  if (params.userAddress) {
    try {
      userFyBal = await client.readContract({
        abi: erc20Abi,
        address: fyToken,
        args: [params.userAddress],
        functionName: "balanceOf",
      });
    } catch {
      userFyBal = null;
    }
  }

  return {
    baseBalance,
    baseDecimals: Number(baseDecimalsRaw),
    baseToken,
    fyBalance,
    fyDecimals: Number(fyDecimalsRaw),
    fySymbol,
    fyToken,
    maturity: Number(maturity),
    userFyBal,
  };
}

function useLendPoolReads(params: {
  tokenId: TokenOption["id"];
  userAddress?: Address;
}): UseLendPoolReadsResult {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof readLendPoolSnapshot>> | null>(
    null
  );
  const [refreshIndex, setRefreshIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void refreshIndex;

    setLoading(true);
    setError(null);

    void readLendPoolSnapshot({ tokenId: params.tokenId, userAddress: params.userAddress })
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
  }, [params.tokenId, params.userAddress, refreshIndex]);

  return {
    baseDecimals: snapshot?.baseDecimals ?? null,
    baseToken: snapshot?.baseToken ?? null,
    error,
    fyDecimals: snapshot?.fyDecimals ?? null,
    fySymbol: snapshot?.fySymbol ?? null,
    fyToken: snapshot?.fyToken ?? null,
    loading,
    maturity: snapshot?.maturity ?? null,
    poolBaseBalance: snapshot?.baseBalance ?? null,
    poolFyBalance: snapshot?.fyBalance ?? null,
    refetch: () => setRefreshIndex((value) => value + 1),
    userFyBal: snapshot?.userFyBal ?? null,
  };
}

async function loadLendMaturityOption(params: {
  token: TokenOption["id"];
}): Promise<MaturityOption> {
  const { client, poolAddress } = getLendPoolConfig(params.token);

  const [baseToken, fyToken, maturity] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: poolAddress, functionName: "baseToken" },
      { abi: poolAbi, address: poolAddress, functionName: "fyToken" },
      { abi: poolAbi, address: poolAddress, functionName: "maturity" },
    ],
  });

  const [baseDecimalsRaw, fyDecimalsRaw, cache, supply] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
      { abi: poolAbi, address: poolAddress, functionName: "getCache" },
      { abi: poolAbi, address: poolAddress, functionName: "totalSupply" },
    ],
  });
  const [poolBaseCached, poolFyCachedVirtual] = cache;
  const realFyCached = poolFyCachedVirtual - supply;

  const baseDecimals = Number(baseDecimalsRaw);
  const fyDecimals = Number(fyDecimalsRaw);
  const maturitySeconds = Number(maturity);
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timeRemaining = BigInt(maturitySeconds) - nowSeconds;

  const aprResult = await fetchLendAprText({
    baseDecimals,
    fyDecimals,
    poolBaseCached,
    poolFyCachedVirtual,
    previewSellBase: (baseIn) =>
      client.readContract({
        abi: poolAbi,
        address: poolAddress,
        args: [baseIn],
        functionName: "sellBasePreview",
      }),
    realFyCached,
    timeRemaining,
  });

  return {
    accent: "lime",
    aprText: aprResult.aprText,
    dateLabel: formatMaturityDateLabel(maturitySeconds),
    disabled: aprResult.unavailable,
    disabledReason: aprResult.unavailable
      ? "Pool not bootstrapped yet (no real fy reserves in cache)."
      : undefined,
    id: `pool:${maturitySeconds}`,
  };
}

function useLendMaturityOptions(token: TokenOption["id"]): MaturityOption[] {
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [options, setOptions] = useState<MaturityOption[]>([]);

  useEffect(() => {
    if (token !== "KESm" && token !== "cNGN") {
      setOptions([]);
      return;
    }

    const intervalMs = token === "cNGN" ? 30_000 : 15_000;
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      setRefreshIndex((value) => value + 1);
    }, intervalMs);

    return () => clearInterval(intervalId);
  }, [token]);

  useEffect(() => {
    let cancelled = false;
    void refreshIndex;
    if (token !== "KESm" && token !== "cNGN") {
      setOptions([]);
      return () => {
        cancelled = true;
      };
    }

    setOptions([{ accent: "lime", aprText: "—", dateLabel: "—", id: "loading" }]);
    void (async () => {
      try {
        const option = await loadLendMaturityOption({ token });
        if (!cancelled) {
          setOptions([option]);
        }
      } catch (caught) {
        if (!cancelled) {
          setOptions([
            {
              accent: "lime",
              aprText: "—",
              dateLabel: "—",
              disabled: true,
              disabledReason: formatRpcError(caught),
              id: "error",
            },
          ]);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token, refreshIndex]);

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
  chainId: number;
  baseDecimals: number | null;
  baseToken: Address | null;
  canContinue: boolean;
  isBase: boolean;
  isCelo: boolean;
  publicClient: AnyPublicClient;
  poolAddress: Address;
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
      isBase: params.isBase,
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
      chainId: params.chainId,
      poolAddress: params.poolAddress,
      publicClient: params.publicClient,
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

        const nextFyBal = await params.publicClient.readContract({
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
  isBase: boolean;
  isCelo: boolean;
  tokenId: TokenOption["id"];
  userAddress: Address | undefined;
  walletClient: ReturnType<typeof usePrivyWalletClient>["walletClient"];
}): { context: LendValidationContext } | { error: string } {
  if (!(params.userAddress && params.walletClient)) {
    return { error: "Connect a wallet to continue." };
  }
  if (params.tokenId === "cNGN" && !params.isBase) {
    return { error: "Please switch your wallet to the Base network." };
  }
  if (params.tokenId === "KESm" && !params.isCelo) {
    return { error: "Please switch your wallet to the Celo network." };
  }
  if (!params.canContinue) {
    return { error: "Enter an amount and select a maturity." };
  }
  if (params.tokenId !== "KESm" && params.tokenId !== "cNGN") {
    return { error: "Lending this asset is not supported yet." };
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
  chainId: number;
  poolAddress: Address;
  publicClient: AnyPublicClient;
  onPhase: (phase: LendTxPhase) => void;
  walletClient: NonNullable<ReturnType<typeof usePrivyWalletClient>["walletClient"]>;
}): Promise<{
  swapBlockNumber: bigint;
  swapHash: Hex;
  swapReceiptLogs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[];
  transferHash: Hex;
}> {
  // Preflight quote: if this reverts (eg NegativeInterestRatesNotAllowed), we abort before wallet prompts.
  const fyOut = await params.publicClient.readContract({
    abi: poolAbi,
    address: params.poolAddress,
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
      args: [params.poolAddress, params.amountInBase],
      chain: params.chainId === base.id ? base : celo,
      functionName: "transfer",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );

  params.onPhase("transfer_pending");
  await params.publicClient.waitForTransactionReceipt({ hash: transferHash });

  params.onPhase("swap_sign");
  const swapHash = await withTimeout(
    params.walletClient.writeContract({
      abi: poolAbi,
      account: params.account,
      address: params.poolAddress,
      args: [params.account, minFyOut],
      chain: params.chainId === base.id ? base : celo,
      functionName: "sellBase",
    }),
    WALLET_TIMEOUT_MS,
    "Wallet confirmation timed out. Re-open your wallet and approve the transaction."
  );

  params.onPhase("swap_pending");
  const swapReceipt = await params.publicClient.waitForTransactionReceipt({ hash: swapHash });

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
  if (params.tokenId !== "KESm" && params.tokenId !== "cNGN") {
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

function TokenIcon({ chainId, tokenId }: { chainId: number; tokenId: TokenOption["id"] }) {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
      <Image
        alt={`${tokenId} token icon`}
        className="h-8 w-8 rounded-full"
        height={32}
        src={TOKEN_ICON_SRC[tokenId]}
        width={32}
      />
      <span className="-bottom-1 -right-1 absolute inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-white shadow-sm">
        <ChainIcon chainId={chainId} className="h-3 w-3" />
      </span>
    </span>
  );
}

function getChainLabel(chainId: number) {
  return CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}

function ChainIcon({ chainId, className }: { chainId: number; className?: string }) {
  if (chainId === 42_220) {
    return (
      <Image
        alt="Celo"
        className={cn("h-3 w-3", className)}
        height={12}
        src="/assets/celo.svg"
        width={12}
      />
    );
  }

  if (chainId === 8453) {
    return (
      <Image
        alt="Base"
        className={cn("h-3 w-3", className)}
        height={12}
        src="/assets/base.svg"
        width={12}
      />
    );
  }
  if (chainId === 42_161) {
    return (
      <Image
        alt="Arbitrum"
        className={cn("h-3 w-3", className)}
        height={12}
        src="/assets/arbitrum.png"
        width={12}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex h-3 w-3 items-center justify-center rounded-full bg-blue-100 font-semibold text-[8px] text-blue-700",
        className
      )}
    >
      B
    </span>
  );
}

function LendMaturityGrid(props: {
  tokenLabel: string;
  selectedMaturityId: string;
  onSelectMaturity: (id: string) => void;
  options: MaturityOption[];
}) {
  const left = props.options[0];
  const right = props.options[1];
  const wide = props.options[2];

  function renderOption(option: MaturityOption, wideLayout: boolean) {
    const isSelected = option.id === props.selectedMaturityId;
    const isDisabled = Boolean(option.disabled) || option.id === "loading" || option.id === "error";
    const dateLine = option.disabledReason
      ? `${option.dateLabel} · ${option.disabledReason}`
      : option.dateLabel;

    if (wideLayout) {
      const backgroundClass = isSelected ? "border-black bg-neutral-50" : "bg-white";
      const interactionClass = isDisabled ? "opacity-60" : "hover:bg-numo-pill/60";
      return (
        <button
          className={cn(
            "col-span-2 flex items-center gap-4 rounded-2xl border border-numo-border px-5 py-4 text-left shadow-sm transition",
            backgroundClass,
            interactionClass
          )}
          disabled={isDisabled}
          onClick={() => props.onSelectMaturity(option.id)}
          type="button"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 shadow-sm">
            <Waves className="h-6 w-6 text-black" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-base text-black">
              {option.aprText} <span className="font-medium text-gray-600">APR</span>
            </div>
            <div className="mt-1 text-gray-500 text-sm">{dateLine}</div>
          </div>
        </button>
      );
    }

    return (
      <button
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-numo-border bg-white px-4 py-4 text-left shadow-sm transition",
          isSelected ? "border-black ring-1 ring-black/10" : "",
          isDisabled ? "opacity-60" : "hover:bg-numo-pill/60"
        )}
        disabled={isDisabled}
        onClick={() => props.onSelectMaturity(option.id)}
        type="button"
      >
        <span
          className={cn(
            "flex h-10 w-10 items-center justify-center rounded-full",
            accentClasses(option.accent)
          )}
        >
          <Waves className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="font-semibold text-black text-sm">
            {option.aprText} <span className="font-medium text-gray-600">APR</span>
          </div>
          <div className="mt-1 text-gray-500 text-xs">{dateLine}</div>
        </div>
      </button>
    );
  }

  return (
    <div className="mt-10">
      <div className="text-gray-500 text-xs">Available {props.tokenLabel}-based maturity dates</div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {props.options.length === 0 ? (
          <div className="col-span-2 rounded-2xl border border-numo-border bg-white px-4 py-4 text-gray-500 text-sm shadow-sm">
            No maturity dates available for {props.tokenLabel} yet.
          </div>
        ) : (
          <>
            {left ? renderOption(left, false) : <div />}
            {right ? renderOption(right, false) : <div />}
            {wide ? renderOption(wide, true) : null}
          </>
        )}
      </div>
    </div>
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
  tokenOptions: TokenOption[];
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
            <p className="mt-1 text-gray-500 text-sm">Lend stablecoins at a fixed rate</p>
          </header>

          <div className="mt-8 flex items-center gap-3">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor="lend-amount">
                Amount
              </label>
              <input
                className={cn(
                  "h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-black shadow-sm outline-none",
                  "placeholder:text-gray-400 focus:border-black focus:ring-1 focus:ring-black"
                )}
                id="lend-amount"
                inputMode="decimal"
                onChange={(event) => props.onAmountChange(event.target.value)}
                placeholder="Enter amount"
                value={props.amount}
              />
            </div>

            <div className="relative" ref={tokenMenuRef}>
              <button
                aria-expanded={tokenMenuOpen}
                aria-haspopup="menu"
                className={cn(
                  "flex h-12 w-56 items-center justify-between gap-3 rounded-full border border-numo-ink bg-white px-3 text-numo-ink shadow-sm",
                  "transition hover:bg-numo-pill/50"
                )}
                onClick={() => setTokenMenuOpen((value) => !value)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  <TokenIcon
                    chainId={props.selectedToken.chainId}
                    tokenId={props.selectedToken.id}
                  />
                  <span className="flex items-center gap-1 font-semibold text-sm">
                    <span>{props.selectedToken.label}</span>
                    <span className="text-numo-muted">·</span>
                    <ChainIcon chainId={props.selectedToken.chainId} />
                    <span className="text-numo-muted">
                      {getChainLabel(props.selectedToken.chainId)}
                    </span>
                  </span>
                </span>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-numo-muted transition-transform",
                    tokenMenuOpen ? "rotate-180" : "rotate-0"
                  )}
                />
              </button>

              {tokenMenuOpen ? (
                <div className="absolute left-0 z-10 mt-3 w-80 rounded-3xl border border-numo-border bg-white p-3 shadow-xl">
                  <div className="px-3 py-2 font-semibold text-numo-muted text-xs tracking-wide">
                    SELECT STABLECOIN
                  </div>
                  {props.tokenOptions.map((option) => {
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
                          <TokenIcon chainId={option.chainId} tokenId={option.id} />
                          <span className="flex flex-col">
                            <span className="font-semibold text-lg text-numo-ink leading-tight">
                              {option.name}
                            </span>
                            <span className="mt-0.5 flex items-center gap-3 text-numo-muted text-sm">
                              <span>{option.label}</span>
                              <span className="text-gray-400">
                                {TOKEN_ADDRESS_LABEL[option.id]}
                              </span>
                            </span>
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <LendMaturityGrid
            onSelectMaturity={props.onMaturitySelect}
            options={props.maturityOptions}
            selectedMaturityId={props.selectedMaturityId}
            tokenLabel={props.selectedToken.label}
          />

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
                        src="/assets/KESm (Mento Mento KES).svg"
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

export function LendFixedRate({ className, selectedChain }: LendFixedRateProps) {
  const userAddress = usePrivyAddress();
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("cNGN");
  const { isBase, isCelo, walletClient } = usePrivyWalletClient();
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
  } = useLendPoolReads({ tokenId: token, userAddress });
  const filteredTokens = useMemo(
    () =>
      TOKENS.filter((option) => {
        if (selectedChain === null) {
          return true;
        }
        return option.chainId === selectedChain;
      }),
    [selectedChain]
  );
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
    (token === "KESm" || token === "cNGN") &&
    isPositiveAmount(amount) &&
    Boolean(selectedMaturity?.id) &&
    selectedMaturity?.id !== "loading" &&
    selectedMaturity?.id !== "error" &&
    !selectedMaturity?.disabled;
  useEffect(() => {
    if (filteredTokens.length === 0) {
      return;
    }
    if (filteredTokens.some((option) => option.id === token)) {
      return;
    }
    setToken(filteredTokens[0].id);
  }, [filteredTokens, token]);

  const selectedToken =
    filteredTokens.find((selectedOption) => selectedOption.id === token) ??
    filteredTokens[0] ??
    TOKENS[0];

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
    const { chainId, client, poolAddress } = getLendPoolConfig(token);
    void handleLendClick({
      amount,
      chainId,
      baseDecimals,
      baseToken,
      canContinue,
      fyToken: fyToken ?? null,
      isBase,
      isCelo,
      poolAddress,
      publicClient: client,
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
      tokenOptions={filteredTokens}
    />
  );
}
