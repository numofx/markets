"use client";

import { ArrowLeft, Check, ChevronDown, ThumbsDown, ThumbsUp, Waves } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";
import { formatUnits, parseUnits } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient as basePublicClient } from "@/lib/baseClients";
import { publicClient as celoPublicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
import { getRevertSelector } from "@/lib/get-revert-selector";
import { useBorrowVaultDiscovery } from "@/lib/useBorrowVaultDiscovery";
import { useBorrowVaultId } from "@/lib/useBorrowVaultId";
import { useBorrowWalletData } from "@/lib/useBorrowWalletData";
import { useKesmPerUsdRate } from "@/lib/useKesmPerUsdRate";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import {
  approveTokenToSpender,
  buildVaultForMarket,
  pourForMarket,
  recoverBorrowPoolForMarket,
  sellFyTokenForMarket,
} from "@/src/borrow-actions";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { quoteFyForKes } from "@/src/borrow-quote";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type BorrowFixedRateProps = {
  className?: string;
  selectedChain: number | null;
};

type BorrowStep = "borrow" | "collateral";
type BorrowReceiveMode = "KESM_NOW" | "FY_KESM";
type TxOutcome = "SUCCESS" | "REVERTED";
type QuoteFailureReason =
  | "INSUFFICIENT_LIQUIDITY"
  | "CACHE_GT_LIVE"
  | "POOL_PENDING"
  | "NEGATIVE_INTEREST_RATES_NOT_ALLOWED"
  | "PREVIEW_REVERT"
  | "UNKNOWN";

type TokenOption = {
  id: "USDT" | "USDC" | "USDC_ARB" | "cNGN" | "BRZ" | "MXNB" | "KESm";
  chainId: number;
  label: string;
  name: string;
};

type CollateralOption = {
  id: "USDT" | "aUSDC";
  chainId: number;
  label: string;
  subtitle: string;
};

type BorrowMarket = {
  chainId: 8453 | 42_220;
  collateralLabel: string;
  collateralSubtitle: string;
  collateralToken: Address;
  collateralJoin: Address;
  poolAddress: Address;
  borrowLabel: string;
  fyLabel: string;
  ladle: Address;
  cauldron: Address;
  seriesId: Hex;
  ilkId: Hex;
};

const TOKEN_ICON_SRC = {
  aUSDC: "/assets/usdc.svg",
  BRZ: "/assets/brz.svg",
  cNGN: "/assets/cngn.png",
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  MXNB: "/assets/mxnb.png",
  USDC: "/assets/usdc.svg",
  USDC_ARB: "/assets/usdc.svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"] | CollateralOption["id"], string>;

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

const TOKEN_ADDRESS_LABEL: Record<TokenOption["id"], string> = {
  BRZ: "0xE918...61B4",
  cNGN: "0xC930...62D3",
  KESm: "0x456a...B0d0",
  MXNB: "0xF197...80aA",
  USDC: "0x8335...2913",
  USDC_ARB: "0xaf88...5831",
  USDT: "0x4806...3D5e",
};
const CHAIN_LABELS: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  42220: "Celo",
};

const COLLATERAL_OPTIONS: CollateralOption[] = [
  { chainId: 42_220, id: "USDT", label: "USDT", subtitle: "Tether USD" },
  { chainId: 8453, id: "aUSDC", label: "aUSDC", subtitle: "Aave USDC" },
];

function getPublicClient(chainId: BorrowMarket["chainId"]) {
  if (chainId === 8453) {
    return basePublicClient;
  }
  return celoPublicClient;
}

function getMarketForToken(token: TokenOption["id"]): BorrowMarket | null {
  if (token === "KESm") {
    return {
      borrowLabel: "KESm",
      cauldron: BORROW_CONFIG.core.cauldron as Address,
      chainId: 42_220,
      collateralJoin: BORROW_CONFIG.joins.usdt as Address,
      collateralLabel: "USDT",
      collateralSubtitle: "Tether USD",
      collateralToken: BORROW_CONFIG.tokens.usdt as Address,
      fyLabel: "fyKESm",
      ilkId: BORROW_CONFIG.ilk.usdt as Hex,
      ladle: BORROW_CONFIG.core.ladle as Address,
      poolAddress: CELO_YIELD_POOL.poolAddress as Address,
      seriesId: BORROW_CONFIG.seriesId.fyKesm as Hex,
    };
  }
  if (token === "cNGN") {
    return {
      borrowLabel: "cNGN",
      cauldron: BORROW_CONFIG.baseCngn.core.cauldron as Address,
      chainId: 8453,
      collateralJoin: BORROW_CONFIG.baseCngn.joins.aUsdc as Address,
      collateralLabel: "aUSDC",
      collateralSubtitle: "Aave USDC",
      collateralToken: BORROW_CONFIG.tokens.aUsdc as Address,
      fyLabel: "fycNGN",
      ilkId: BORROW_CONFIG.baseCngn.ilk.aUsdc as Hex,
      ladle: BORROW_CONFIG.baseCngn.core.ladle as Address,
      poolAddress: BORROW_CONFIG.baseCngn.pool.address as Address,
      seriesId: BORROW_CONFIG.baseCngn.seriesId.fycNgn as Hex,
    };
  }
  return null;
}

function formatMaturityDateLabel(maturitySeconds: number) {
  // Match the screenshot style (e.g. "31 Dec 2021"), but always in UTC.
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(maturitySeconds * 1000));
}

const U128_MAX = BigInt("340282366920938463463374607431768211455");
const MAX_REASONABLE_APR_WAD = 10n * WAD; // 1000%

function toWad(value: bigint, decimals: number) {
  if (decimals === 18) {
    return value;
  }
  if (decimals < 18) {
    return value * 10n ** BigInt(18 - decimals);
  }
  return value / 10n ** BigInt(decimals - 18);
}

function isNegativeInterestRatesNotAllowed(caught: unknown) {
  const selector = getRevertSelector(caught);
  if (selector === "0xb24d9e1b") {
    return true;
  }
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  return message.includes("NegativeInterestRatesNotAllowed");
}

type BorrowAprContext = {
  baseDecimals: number;
  fyDecimals: number;
  maturitySeconds: number;
  poolAddress: Address;
  poolBaseCached: bigint;
  poolFyCachedVirtual: bigint;
  poolSupply: bigint;
};

async function readBorrowAprContextForMarket(params: {
  chainId: BorrowMarket["chainId"];
  poolAddress: Address;
}): Promise<BorrowAprContext> {
  const client = getPublicClient(params.chainId);
  const [baseToken, fyToken, maturity, cache, supply] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: poolAbi, address: params.poolAddress, functionName: "baseToken" },
      { abi: poolAbi, address: params.poolAddress, functionName: "fyToken" },
      { abi: poolAbi, address: params.poolAddress, functionName: "maturity" },
      { abi: poolAbi, address: params.poolAddress, functionName: "getCache" },
      { abi: poolAbi, address: params.poolAddress, functionName: "totalSupply" },
    ],
  });

  const [baseDecimals, fyDecimals] = await client.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
    ],
  });
  const [poolBaseCached, poolFyCachedVirtual] = cache;

  return {
    baseDecimals: Number(baseDecimals),
    fyDecimals: Number(fyDecimals),
    maturitySeconds: Number(maturity),
    poolAddress: params.poolAddress,
    poolBaseCached,
    poolFyCachedVirtual,
    poolSupply: supply,
  };
}

async function quoteAprFromTinySellBasePreview(params: {
  chainId: BorrowMarket["chainId"];
  baseDecimals: number;
  fyDecimals: number;
  poolAddress: Address;
  poolBaseCached: bigint;
  poolFyCachedVirtual: bigint;
  realFyCached: bigint;
  timeRemaining: bigint;
}) {
  const client = getPublicClient(params.chainId);
  if (params.timeRemaining <= 0n || params.realFyCached <= 0n) {
    return {
      aprText: "—",
      disabled: true,
      disabledReason: "Pool not bootstrapped yet (no real fy reserves in cache).",
    };
  }

  const reservePWad =
    (toWad(params.poolBaseCached, params.baseDecimals) * WAD) /
    toWad(params.poolFyCachedVirtual, params.fyDecimals);
  let pricePWad = reservePWad;

  try {
    const baseUnit = 10n ** BigInt(params.baseDecimals);
    const baseIn = baseUnit / 1000n || 1n;
    if (baseIn <= U128_MAX) {
      const fyOut = await client.readContract({
        abi: poolAbi,
        address: params.poolAddress,
        args: [baseIn],
        functionName: "sellBasePreview",
      });

      if (fyOut > 0n) {
        const previewPWad =
          (toWad(baseIn, params.baseDecimals) * WAD) / toWad(fyOut, params.fyDecimals);
        // Guard against tiny-trade quote outliers. If preview price diverges too much from reserves,
        // use reserve-implied spot for APR display.
        const lower = reservePWad / 4n;
        const upper = reservePWad * 4n;
        if (previewPWad >= lower && previewPWad <= upper) {
          pricePWad = previewPWad;
        }
      }
    }
  } catch (caught) {
    if (isNegativeInterestRatesNotAllowed(caught)) {
      return {
        aprText: "—",
        disabled: true,
        disabledReason: "Pool currently rejects borrow/lend trades for this maturity.",
      };
    }
  }

  const aprWad = aprFromPriceWad(pricePWad, params.timeRemaining);
  if (aprWad !== null && aprWad > MAX_REASONABLE_APR_WAD) {
    return {
      aprText: "—",
      disabled: false,
      disabledReason: "APR quote out of display range; price appears anomalous.",
    };
  }
  return {
    aprText: formatAprPercent(aprWad),
    disabled: false,
    disabledReason: undefined,
  };
}

async function fetchBorrowMaturityOptionForMarket(market: BorrowMarket): Promise<MaturityOption> {
  const ctx = await readBorrowAprContextForMarket({
    chainId: market.chainId,
    poolAddress: market.poolAddress,
  });
  const maturitySeconds = ctx.maturitySeconds;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timeRemaining = BigInt(maturitySeconds) - nowSeconds;

  const quote = await quoteAprFromTinySellBasePreview({
    baseDecimals: ctx.baseDecimals,
    chainId: market.chainId,
    fyDecimals: ctx.fyDecimals,
    poolAddress: ctx.poolAddress,
    poolBaseCached: ctx.poolBaseCached,
    poolFyCachedVirtual: ctx.poolFyCachedVirtual,
    realFyCached: ctx.poolFyCachedVirtual - ctx.poolSupply,
    timeRemaining,
  });

  return {
    accent: "lime",
    aprText: quote.aprText,
    dateLabel: Number.isFinite(maturitySeconds) ? formatMaturityDateLabel(maturitySeconds) : "—",
    disabled: quote.disabled,
    disabledReason: quote.disabledReason,
    id: `pool:${maturitySeconds}`,
  };
}

function useBorrowMaturityOptions(market: BorrowMarket | null): MaturityOption[] {
  const [options, setOptions] = useState<MaturityOption[]>([
    { accent: "lime", aprText: "—", dateLabel: "—", id: "loading" },
  ]);

  useEffect(() => {
    if (!market) {
      setOptions([{ accent: "lime", aprText: "—", dateLabel: "—", id: "unsupported" }]);
      return;
    }

    let cancelled = false;
    const run = async () => {
      try {
        const next: MaturityOption[] = [await fetchBorrowMaturityOptionForMarket(market)];
        if (!cancelled) {
          setOptions(next);
        }
      } catch {
        if (!cancelled) {
          setOptions([{ accent: "lime", aprText: "—", dateLabel: "—", id: "error" }]);
        }
      }
    };

    void run();
    const intervalId = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      void run();
    }, 15_000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [market]);

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

function safeParseAmount(value: string, decimals: number) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // Accept inputs like ".5" by normalizing to "0.5".
  const normalizedLeading = trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
  // Avoid parseUnits throwing on a trailing decimal point while typing (e.g. "1.").
  const normalized = normalizedLeading.endsWith(".")
    ? normalizedLeading.slice(0, Math.max(0, normalizedLeading.length - 1))
    : normalizedLeading;

  const numeric = Number.parseFloat(normalized);
  if (!normalized || Number.isNaN(numeric) || numeric <= 0) {
    return null;
  }
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return null;
  }
}

function getBorrowValidationError(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  collateral: bigint | null;
  borrow: bigint | null;
  collateralBalance: bigint | null;
  collateralLabel: string;
  token: TokenOption["id"];
}) {
  if (!params.userAddress) {
    return "Connect wallet to continue.";
  }
  if (!params.walletClient) {
    return "Wallet client unavailable.";
  }
  if (params.token !== "KESm" && params.token !== "cNGN") {
    return "Borrowing this asset is not supported yet.";
  }
  if (!(params.collateral && params.borrow)) {
    return "Enter collateral and borrow amounts.";
  }
  if (params.collateralBalance !== null && params.collateral > params.collateralBalance) {
    return `Insufficient ${params.collateralLabel} balance.`;
  }
  return null;
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

function CollateralIcon({
  chainId,
  collateralId,
}: {
  chainId: number;
  collateralId: CollateralOption["id"];
}) {
  return (
    <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center">
      <Image
        alt={`${collateralId} token icon`}
        className="h-8 w-8 rounded-full"
        height={32}
        src={TOKEN_ICON_SRC[collateralId]}
        width={32}
      />
      <span className="-bottom-1 -right-1 absolute inline-flex h-4 w-4 items-center justify-center rounded-full border border-white bg-white shadow-sm">
        <ChainIcon chainId={chainId} className="h-3 w-3" />
      </span>
    </span>
  );
}

function quoteUnavailableHint(reason: QuoteFailureReason | undefined) {
  switch (reason) {
    case "INSUFFICIENT_LIQUIDITY":
      return "Pool liquidity is too low for this borrow size. Try a smaller amount.";
    case "CACHE_GT_LIVE":
      return "Pool cache exceeds live balances. Pool state appears inconsistent; try again later or perform a small sync trade/mint to refresh the pool.";
    case "POOL_PENDING":
      return "Pool has pending (unprocessed) balances, likely from a previous failed trade or a token transfer without a swap/mint. Sync the pool (a successful mint/burn/trade) and try again.";
    case "NEGATIVE_INTEREST_RATES_NOT_ALLOWED":
      return "Pool rejected the trade (negative interest rates not allowed). Try a smaller amount.";
    case "PREVIEW_REVERT":
      return "Pool quote preview reverted. Try a smaller amount.";
    default:
      return "Try a smaller amount.";
  }
}

async function runBorrowFlow(params: {
  account: Address;
  walletClient: WalletClient;
  market: BorrowMarket;
  collateralAmount: bigint;
  borrowDesired: bigint;
  receiveMode: BorrowReceiveMode;
  collateralAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  onStatus: (status: string) => void;
  onTxHash: (hash: Hex) => void;
  persistVaultId: (vaultId: Hex) => void;
}) {
  const publicClient = getPublicClient(params.market.chainId);
  // Privy/wallet providers can occasionally race nonces for multi-tx flows.
  // We manage nonces ourselves to keep tx ordering deterministic.
  let nextNonce = await publicClient.getTransactionCount({
    address: params.account,
    blockTag: "pending",
  });

  const needsApproval =
    params.collateralAllowance === null || params.collateralAllowance < params.collateralAmount;
  if (needsApproval) {
    params.onStatus(`Step 1/4: Approving ${params.market.collateralLabel}…`);
    const approval = await approveTokenToSpender({
      account: params.account,
      amount: params.collateralAmount,
      chainId: params.market.chainId,
      nonce: nextNonce,
      spender: params.market.collateralJoin,
      token: params.market.collateralToken,
      walletClient: params.walletClient,
    });
    nextNonce += 1;
    params.onTxHash(approval.txHash);
  }

  let nextVaultId: Hex | null = params.vaultId;
  if (!nextVaultId) {
    params.onStatus("Step 2/4: Building vault…");
    const built = await buildVaultForMarket({
      account: params.account,
      chainId: params.market.chainId,
      ilkId: params.market.ilkId,
      ladle: params.market.ladle,
      nonce: nextNonce,
      seriesId: params.market.seriesId,
      walletClient: params.walletClient,
    });
    nextNonce += 1;
    nextVaultId = built.vaultId;
    params.onTxHash(built.txHash);
    params.persistVaultId(nextVaultId);
    if (typeof window !== "undefined" && params.storageKey) {
      window.localStorage.setItem(params.storageKey, nextVaultId);
    }
  }
  if (!nextVaultId) {
    throw new Error("Vault unavailable.");
  }

  if (params.receiveMode === "FY_KESM") {
    params.onStatus(`Step 3/3: Supplying collateral and borrowing ${params.market.fyLabel}…`);
    const result = await pourForMarket({
      account: params.account,
      art: params.borrowDesired,
      chainId: params.market.chainId,
      ink: params.collateralAmount,
      ladle: params.market.ladle,
      nonce: nextNonce,
      to: params.account,
      vaultId: nextVaultId,
      walletClient: params.walletClient,
    });
    params.onTxHash(result.txHash);
    return { vaultId: nextVaultId };
  }

  const quote = await quoteFyForKes(params.borrowDesired, {
    chainId: params.market.chainId,
    poolAddress: params.market.poolAddress,
  });
  if (quote.fyToBorrow <= 0n) {
    const reason = quote.reason ?? "UNKNOWN";
    throw new Error(`QUOTE_UNAVAILABLE|${reason}`);
  }

  params.onStatus("Step 3/4: Supplying collateral and borrowing…");
  const result = await pourForMarket({
    account: params.account,
    art: quote.fyToBorrow,
    chainId: params.market.chainId,
    ink: params.collateralAmount,
    ladle: params.market.ladle,
    nonce: nextNonce,
    to: params.market.poolAddress,
    vaultId: nextVaultId,
    walletClient: params.walletClient,
  });
  nextNonce += 1;
  params.onTxHash(result.txHash);

  const slippageBps = 50n;
  const minBaseOut = (params.borrowDesired * (10_000n - slippageBps)) / 10_000n;
  params.onStatus(`Step 4/4: Swapping ${params.market.fyLabel} into ${params.market.borrowLabel}…`);
  const swapResult = await sellFyTokenForMarket({
    account: params.account,
    chainId: params.market.chainId,
    minBaseOut,
    nonce: nextNonce,
    poolAddress: params.market.poolAddress,
    walletClient: params.walletClient,
  });
  params.onTxHash(swapResult.txHash);

  return { vaultId: nextVaultId };
}

function useDismissOnEscapeAndOutsideClick(
  open: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  onDismiss: () => void
) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      onDismiss();
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (containerRef.current?.contains(target)) {
        return;
      }
      onDismiss();
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [containerRef, onDismiss, open]);
}

function TokenDropdown({
  open,
  selected,
  onToggle,
}: {
  open: boolean;
  selected: TokenOption | undefined;
  onToggle: () => void;
}) {
  return (
    <button
      aria-expanded={open}
      aria-haspopup="menu"
      className={cn(
        "flex h-12 w-56 items-center justify-between gap-3 rounded-full border border-numo-ink bg-white px-3 text-numo-ink shadow-sm",
        "transition hover:bg-numo-pill/50"
      )}
      onClick={onToggle}
      type="button"
    >
      <span className="flex items-center gap-3">
        {selected ? <TokenIcon chainId={selected.chainId} tokenId={selected.id} /> : null}
        {selected ? (
          <span className="flex items-center gap-1 font-semibold text-sm">
            <span>{selected.label}</span>
            <span className="text-numo-muted">·</span>
            <ChainIcon chainId={selected.chainId} />
            <span className="text-numo-muted">{getChainLabel(selected.chainId)}</span>
          </span>
        ) : null}
      </span>
      <ChevronDown
        className={cn(
          "h-4 w-4 text-numo-muted transition-transform",
          open ? "rotate-180" : "rotate-0"
        )}
      />
    </button>
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

function MaturityGrid({
  tokenLabel,
  selectedMaturityId,
  onSelectMaturity,
  options,
}: {
  tokenLabel: string;
  selectedMaturityId: string;
  onSelectMaturity: (id: string) => void;
  options: MaturityOption[];
}) {
  const left = options[0];
  const right = options[1];
  const wide = options[2];

  const renderOption = (option: MaturityOption, wideLayout: boolean) => {
    const isSelected = option.id === selectedMaturityId;
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
          onClick={() => onSelectMaturity(option.id)}
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
        onClick={() => onSelectMaturity(option.id)}
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
  };

  return (
    <div className="mt-10">
      <div className="text-gray-500 text-xs">Available {tokenLabel}-based maturity dates</div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {left ? renderOption(left, false) : <div />}

        {right ? renderOption(right, false) : <div />}

        {wide ? renderOption(wide, true) : null}
      </div>
    </div>
  );
}

function CollateralCard({
  collateralInput,
  onCollateralChange,
  collateralBalance,
  collateralDecimals,
  collateralLabel,
  collateralOptions,
  selectedCollateral,
  onMax,
  collateralMenuOpen,
  collateralMenuRef,
  onToggleCollateralMenu,
  onCloseCollateralMenu,
}: {
  collateralInput: string;
  onCollateralChange: (value: string) => void;
  collateralBalance: bigint | null;
  collateralDecimals: number;
  collateralLabel: string;
  collateralOptions: CollateralOption[];
  selectedCollateral: CollateralOption;
  onMax: () => void;
  collateralMenuOpen: boolean;
  collateralMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleCollateralMenu: () => void;
  onCloseCollateralMenu: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-gray-500 text-xs">Collateral</div>
          <input
            className="mt-2 w-full bg-transparent text-black text-lg outline-none placeholder:text-gray-400"
            inputMode="decimal"
            onChange={(event) => onCollateralChange(event.target.value)}
            placeholder="0"
            value={collateralInput}
          />
          <div className="mt-1 text-gray-500 text-xs">
            Balance:{" "}
            {collateralBalance === null
              ? "—"
              : `${formatUnits(collateralBalance, collateralDecimals)} ${collateralLabel}`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="relative" ref={collateralMenuRef}>
            <button
              aria-expanded={collateralMenuOpen}
              aria-haspopup="menu"
              className={cn(
                "flex h-12 w-40 items-center justify-between gap-2 rounded-full border border-gray-200 bg-white px-3 text-black shadow-sm",
                "transition hover:bg-numo-pill/50"
              )}
              onClick={onToggleCollateralMenu}
              type="button"
            >
              <span className="flex items-center gap-2">
                <CollateralIcon
                  chainId={selectedCollateral.chainId}
                  collateralId={selectedCollateral.id}
                />
                <span className="font-semibold text-sm">{selectedCollateral.label}</span>
              </span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 text-numo-muted transition-transform",
                  collateralMenuOpen ? "rotate-180" : "rotate-0"
                )}
              />
            </button>

            {collateralMenuOpen ? (
              <div className="absolute right-0 z-10 mt-3 w-80 rounded-3xl border border-numo-border bg-white p-3 shadow-xl">
                <div className="px-3 py-2 font-semibold text-numo-muted text-xs tracking-wide">
                  SELECT STABLECOIN
                </div>
                {collateralOptions.map((option) => (
                  <button
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl bg-numo-pill px-3 py-3 text-left text-numo-ink transition hover:bg-numo-pill/60"
                    )}
                    key={option.id}
                    onClick={() => onCloseCollateralMenu()}
                    type="button"
                  >
                    <span className="flex items-center gap-3">
                      <CollateralIcon chainId={option.chainId} collateralId={option.id} />
                      <span className="flex flex-col">
                        <span className="font-semibold text-numo-ink text-sm">{option.label}</span>
                        <span className="text-numo-muted text-sm">{option.subtitle}</span>
                      </span>
                    </span>
                    <Check className="h-5 w-5 text-black" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            className="rounded-full bg-gray-100 px-3 py-2 font-semibold text-black text-xs transition hover:bg-gray-200 disabled:opacity-50"
            disabled={collateralBalance === null}
            onClick={onMax}
            type="button"
          >
            MAX
          </button>
        </div>
      </div>
    </div>
  );
}

function getSubmitButtonLabel(params: {
  isSubmitting: boolean;
  primaryLabel?: string;
  txOutcome?: TxOutcome | null;
}) {
  if (params.isSubmitting) {
    return "Submitting…";
  }
  if (params.txOutcome === "SUCCESS") {
    return "Success";
  }
  if (params.txOutcome === "REVERTED") {
    return "Reverted";
  }
  return params.primaryLabel ?? "Next Step";
}

function SubmitSection({
  canContinue,
  isSubmitting,
  onSubmit,
  primaryLabel,
  secondaryAction,
  txOutcome,
  submitError,
  txHash,
  txStatus,
}: {
  canContinue: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  primaryLabel?: string;
  secondaryAction?: { label: string; onClick: () => void } | null;
  txOutcome?: TxOutcome | null;
  submitError: string | null;
  txHash: Hex | null;
  txStatus: string | null;
}) {
  // If we don't have a tx hash, treat txStatus as an error/notice and render it inline.
  // The "status card" is reserved for in-flight / submitted transactions.
  const inlineStatus = txHash ? null : txStatus;
  const buttonLabel = getSubmitButtonLabel({ isSubmitting, primaryLabel, txOutcome });
  return (
    <>
      <button
        className={cn(
          "mt-10 h-12 w-full rounded-2xl border font-semibold text-sm shadow-sm transition",
          canContinue
            ? "border-black bg-black text-white hover:bg-neutral-800"
            : "border-gray-200 bg-gray-200 text-gray-500"
        )}
        disabled={!canContinue || isSubmitting}
        onClick={onSubmit}
        type="button"
      >
        {buttonLabel}
      </button>

      {secondaryAction ? (
        <button
          className="mt-2 h-10 w-full rounded-2xl border border-gray-200 bg-white font-semibold text-black text-sm transition hover:bg-gray-50"
          disabled={isSubmitting}
          onClick={secondaryAction.onClick}
          type="button"
        >
          {secondaryAction.label}
        </button>
      ) : null}

      {submitError ? <div className="mt-3 text-rose-700 text-xs">{submitError}</div> : null}
      {inlineStatus ? <div className="mt-2 text-rose-700 text-xs">{inlineStatus}</div> : null}

      {txHash ? (
        <div className="mt-4 rounded-2xl border border-numo-border bg-white/80 px-4 py-3 text-numo-ink text-sm shadow-sm backdrop-blur">
          <div className="font-semibold">{txStatus ?? "Transaction submitted."}</div>
          {txHash ? <div className="mt-2 break-all text-numo-muted text-xs">{txHash}</div> : null}
        </div>
      ) : null}
    </>
  );
}

function BorrowAmountRow({
  borrowInput,
  onBorrowChange,
  tokenMenuOpen,
  tokenMenuRef,
  selectedToken,
  tokenOptions,
  onToggleTokenMenu,
  onSelectToken,
  token,
}: {
  borrowInput: string;
  onBorrowChange: (value: string) => void;
  tokenMenuOpen: boolean;
  tokenMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedToken: TokenOption | undefined;
  tokenOptions: TokenOption[];
  onToggleTokenMenu: () => void;
  onSelectToken: (id: TokenOption["id"]) => void;
  token: TokenOption["id"];
}) {
  return (
    <div className="mt-8 flex items-center gap-3">
      <div className="flex-1">
        <label className="sr-only" htmlFor="borrow-amount">
          Amount
        </label>
        <input
          className={cn(
            "h-12 w-full rounded-2xl border border-gray-200 bg-white px-4 text-black shadow-sm outline-none",
            "placeholder:text-gray-400 focus:border-black focus:ring-1 focus:ring-black"
          )}
          id="borrow-amount"
          inputMode="decimal"
          onChange={(event) => onBorrowChange(event.target.value)}
          placeholder={token === "KESm" || token === "cNGN" ? "Enter amount" : "Coming soon"}
          value={borrowInput}
        />
      </div>

      <div className="relative" ref={tokenMenuRef}>
        <TokenDropdown onToggle={onToggleTokenMenu} open={tokenMenuOpen} selected={selectedToken} />

        {tokenMenuOpen ? (
          <div
            className="absolute left-0 z-10 mt-3 w-80 rounded-3xl border border-numo-border bg-white p-3 shadow-xl"
            role="menu"
          >
            <div className="px-3 py-2 font-semibold text-numo-muted text-xs tracking-wide">
              SELECT STABLECOIN
            </div>
            {tokenOptions.map((option) => {
              const isSelected = option.id === token;
              return (
                <button
                  className={cn(
                    "flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left text-numo-ink",
                    "transition hover:bg-numo-pill/60",
                    isSelected ? "bg-numo-pill" : "bg-transparent"
                  )}
                  key={option.id}
                  onClick={() => onSelectToken(option.id)}
                  role="menuitem"
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
                        <span className="text-gray-400">{TOKEN_ADDRESS_LABEL[option.id]}</span>
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
  );
}

function getPreflightError(params: {
  connectedChainId: number | null;
  expectedChainId: number;
  submitError: string | null;
  parsedCollateral: bigint | null;
  parsedBorrow: bigint | null;
}) {
  if (params.connectedChainId !== params.expectedChainId) {
    return `Switch wallet network to chain ${params.expectedChainId}.`;
  }
  if (params.submitError) {
    return params.submitError;
  }
  if (!(params.parsedCollateral && params.parsedBorrow)) {
    return "Enter collateral and borrow amounts.";
  }
  return null;
}

function formatVaultId(vaultId: Hex) {
  const clean = vaultId.toLowerCase();
  return `${clean.slice(0, 10)}…${clean.slice(-6)}`;
}

function computeCollateralizationPercent(params: {
  collateral: bigint | null;
  collateralDecimals: number;
  debt: bigint | null;
  debtDecimals: number;
  kesmPerUsdWad: bigint | null;
}) {
  if (!(params.collateral && params.debt && params.kesmPerUsdWad)) {
    return null;
  }
  if (params.collateral <= 0n || params.debt <= 0n) {
    return null;
  }
  // Assume 1 USDT ~= 1 USD, then convert USD value into KESm using onchain oracle rate.
  const collateralUsdWad = (params.collateral * WAD) / 10n ** BigInt(params.collateralDecimals);
  const collateralKesmWad = (collateralUsdWad * params.kesmPerUsdWad) / WAD;
  const debtWad = (params.debt * WAD) / 10n ** BigInt(params.debtDecimals);
  if (debtWad <= 0n) {
    return null;
  }
  const ratioWad = (collateralKesmWad * WAD) / debtWad; // (KESm collateral value) / (KESm debt)
  const percentWad = ratioWad * 100n;
  const percent = Number.parseFloat(formatUnits(percentWad, 18));
  return Number.isFinite(percent) ? percent : null;
}

function getBorrowStepError(token: TokenOption["id"], parsedBorrowAmount: bigint | null) {
  if (token !== "KESm" && token !== "cNGN") {
    return "Borrowing this asset is not supported yet.";
  }
  if (!parsedBorrowAmount) {
    return "Enter amount to borrow.";
  }
  return null;
}

function parseQuoteFailureReason(message: string): QuoteFailureReason | null {
  const prefix = "QUOTE_UNAVAILABLE|";
  if (!message.startsWith(prefix)) {
    return null;
  }
  const raw = message.slice(prefix.length);
  switch (raw) {
    case "INSUFFICIENT_LIQUIDITY":
    case "CACHE_GT_LIVE":
    case "POOL_PENDING":
    case "NEGATIVE_INTEREST_RATES_NOT_ALLOWED":
    case "PREVIEW_REVERT":
    case "UNKNOWN":
      return raw;
    default:
      return "UNKNOWN";
  }
}

async function submitBorrowTx(params: {
  account: Address;
  walletClient: WalletClient;
  market: BorrowMarket;
  parsedCollateral: bigint;
  parsedBorrow: bigint;
  receiveMode: BorrowReceiveMode;
  collateralAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  onStatus: (status: string) => void;
  onTxHash: (hash: Hex) => void;
  persistVaultId: (vaultId: Hex) => void;
}) {
  try {
    const flow = await runBorrowFlow({
      account: params.account,
      borrowDesired: params.parsedBorrow,
      collateralAllowance: params.collateralAllowance,
      collateralAmount: params.parsedCollateral,
      market: params.market,
      onStatus: params.onStatus,
      onTxHash: params.onTxHash,
      persistVaultId: params.persistVaultId,
      receiveMode: params.receiveMode,
      storageKey: params.storageKey,
      vaultId: params.vaultId,
      walletClient: params.walletClient,
    });
    return { ok: true as const, vaultId: flow.vaultId };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Borrow failed.";
    const quoteReason = parseQuoteFailureReason(message);
    if (quoteReason) {
      return {
        message: `Quote unavailable. ${quoteUnavailableHint(quoteReason)}`,
        ok: false as const,
        quoteReason,
      };
    }
    return { message, ok: false as const, quoteReason: null };
  }
}

async function handleBorrowSubmit(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  connectedChainId: number | null;
  market: BorrowMarket;
  submitError: string | null;
  parsedCollateral: bigint | null;
  parsedBorrow: bigint | null;
  receiveMode: BorrowReceiveMode;
  collateralAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  setIsSubmitting: (value: boolean) => void;
  setQuoteFailureReason: (value: QuoteFailureReason | null) => void;
  setTxOutcome: (value: TxOutcome | null) => void;
  setTxStatus: (value: string | null) => void;
  setTxHash: (value: Hex | null) => void;
  setVaultId: (value: Hex | null) => void;
  refetch: (address: Address) => Promise<void>;
}) {
  if (!(params.userAddress && params.walletClient)) {
    return;
  }

  const preflightError = getPreflightError({
    connectedChainId: params.connectedChainId,
    expectedChainId: params.market.chainId,
    parsedBorrow: params.parsedBorrow,
    parsedCollateral: params.parsedCollateral,
    submitError: params.submitError,
  });
  if (preflightError) {
    params.setTxStatus(preflightError);
    return;
  }

  const collateral = params.parsedCollateral as bigint;
  const borrowDesired = params.parsedBorrow as bigint;

  params.setIsSubmitting(true);
  params.setQuoteFailureReason(null);
  params.setTxOutcome(null);
  params.setTxStatus(null);
  params.setTxHash(null);

  const result = await submitBorrowTx({
    account: params.userAddress,
    collateralAllowance: params.collateralAllowance,
    market: params.market,
    onStatus: (status) => params.setTxStatus(status),
    onTxHash: (hash) => params.setTxHash(hash),
    parsedBorrow: borrowDesired,
    parsedCollateral: collateral,
    persistVaultId: (next) => params.setVaultId(next),
    receiveMode: params.receiveMode,
    storageKey: params.storageKey,
    vaultId: params.vaultId,
    walletClient: params.walletClient,
  });

  if (!result.ok) {
    params.setQuoteFailureReason(result.quoteReason ?? null);
    params.setTxOutcome("REVERTED");
    params.setTxStatus(result.message);
    params.setIsSubmitting(false);
    return;
  }

  params.setQuoteFailureReason(null);
  params.setTxOutcome("SUCCESS");
  params.setTxStatus("Position updated.");
  params.setVaultId(result.vaultId);
  await params.refetch(params.userAddress);
  params.setIsSubmitting(false);
}

async function handleRecoverPool(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  market: BorrowMarket;
  setIsSubmitting: (value: boolean) => void;
  setQuoteFailureReason: (value: QuoteFailureReason | null) => void;
  setTxOutcome: (value: TxOutcome | null) => void;
  setTxHash: (value: Hex | null) => void;
  setTxStatus: (value: string | null) => void;
}) {
  if (!(params.userAddress && params.walletClient)) {
    return;
  }

  params.setIsSubmitting(true);
  params.setTxOutcome(null);
  params.setTxHash(null);
  params.setTxStatus("Checking pool state…");
  try {
    const recovery = await recoverBorrowPoolForMarket({
      account: params.userAddress,
      chainId: params.market.chainId,
      onStatus: (status) => params.setTxStatus(status),
      onTxHash: (hash) => params.setTxHash(hash),
      poolAddress: params.market.poolAddress,
      walletClient: params.walletClient,
    });
    if (recovery.reason === "CACHE_GT_LIVE") {
      params.setTxOutcome("REVERTED");
      params.setTxStatus(
        "Pool cache exceeds live balances. Try again later or run a small manual sync trade."
      );
      return;
    }
    if (recovery.cleaned) {
      params.setQuoteFailureReason(null);
      params.setTxOutcome("SUCCESS");
      params.setTxStatus("Pool synced. You can borrow again.");
      return;
    }
    params.setTxOutcome("REVERTED");
    params.setTxStatus("Pool still has pending balances. Retry Fix Pool.");
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Pool sync failed.";
    params.setTxOutcome("REVERTED");
    params.setTxStatus(message);
  } finally {
    params.setIsSubmitting(false);
  }
}

function BorrowStepView(params: {
  borrowInput: string;
  onBorrowChange: (value: string) => void;
  token: TokenOption["id"];
  selectedToken: TokenOption | undefined;
  tokenOptions: TokenOption[];
  tokenMenuOpen: boolean;
  tokenMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleTokenMenu: () => void;
  onSelectToken: (id: TokenOption["id"]) => void;
  selectedMaturityId: string;
  onSelectMaturity: (id: string) => void;
  maturityOptions: MaturityOption[];
  canProceed: boolean;
  borrowStepError: string | null;
  onNext: () => void;
}) {
  return (
    <>
      <header>
        <h2 className="font-semibold text-3xl text-black">Borrow</h2>
        <p className="mt-1 text-gray-500 text-sm">Borrow stablecoins at a fixed rate</p>
      </header>

      <BorrowAmountRow
        borrowInput={params.borrowInput}
        onBorrowChange={params.onBorrowChange}
        onSelectToken={params.onSelectToken}
        onToggleTokenMenu={params.onToggleTokenMenu}
        selectedToken={params.selectedToken}
        token={params.token}
        tokenMenuOpen={params.tokenMenuOpen}
        tokenMenuRef={params.tokenMenuRef}
        tokenOptions={params.tokenOptions}
      />

      <MaturityGrid
        onSelectMaturity={params.onSelectMaturity}
        options={params.maturityOptions}
        selectedMaturityId={params.selectedMaturityId}
        tokenLabel={params.token}
      />

      <SubmitSection
        canContinue={params.canProceed}
        isSubmitting={false}
        onSubmit={params.onNext}
        submitError={null}
        txHash={null}
        txOutcome={null}
        txStatus={null}
      />
    </>
  );
}

function CollateralStepView(params: {
  market: BorrowMarket;
  collateralInput: string;
  onCollateralChange: (value: string) => void;
  collateralBalance: bigint | null;
  collateralDecimals: number;
  onMaxCollateral: () => void;
  collateralMenuOpen: boolean;
  collateralMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleCollateralMenu: () => void;
  onCloseCollateralMenu: () => void;
  collateralizationPercent: number | null;
  vaultId: Hex | null;
  vaultDiscoveryStatus: "idle" | "loading" | "ready" | "error";
  vaultDiscoveryError: string | null;
  canSubmit: boolean;
  quoteFailureReason: QuoteFailureReason | null;
  receiveMode: BorrowReceiveMode;
  onSelectReceiveMode: (mode: BorrowReceiveMode) => void;
  isSubmitting: boolean;
  onSubmit: () => void;
  onRecoverPool: () => void;
  submitError: string | null;
  txHash: Hex | null;
  txStatus: string | null;
  txOutcome: TxOutcome | null;
  onBack: () => void;
}) {
  let vaultLabel = "No vault found.";
  if (params.vaultDiscoveryStatus === "loading") {
    vaultLabel = "Searching onchain…";
  }
  if (params.vaultId) {
    vaultLabel = formatVaultId(params.vaultId);
  }

  const collateralizationLabel =
    params.collateralizationPercent === null
      ? "—"
      : `${params.collateralizationPercent.toFixed(0)}%`;
  const collateralOk =
    params.collateralizationPercent !== null && params.collateralizationPercent >= 110;
  const showPoolRecover = params.quoteFailureReason === "POOL_PENDING";

  return (
    <>
      <button
        aria-label="Back"
        className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted shadow-sm transition hover:bg-numo-pill/60"
        onClick={params.onBack}
        type="button"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>

      <div className="grid grid-cols-2 items-center gap-4">
        <div className="relative flex h-28 w-28 items-center justify-center">
          <div className="absolute inset-0 rounded-full border-8 border-numo-pill" />
          {collateralOk ? (
            <ThumbsUp className="h-8 w-8 text-emerald-700" />
          ) : (
            <ThumbsDown className="h-8 w-8 text-rose-500" />
          )}
        </div>
        <div className="text-center">
          <div className="text-numo-muted text-sm">Collateralization</div>
          <div className="font-semibold text-2xl text-numo-ink">{collateralizationLabel}</div>
        </div>
      </div>

      <div className="mt-6 text-numo-muted text-xs">Amount of collateral to add</div>
      <CollateralCard
        collateralBalance={params.collateralBalance}
        collateralDecimals={params.collateralDecimals}
        collateralInput={params.collateralInput}
        collateralLabel={params.market.collateralLabel}
        collateralMenuOpen={params.collateralMenuOpen}
        collateralMenuRef={params.collateralMenuRef}
        collateralOptions={COLLATERAL_OPTIONS.filter(
          (option) => option.chainId === params.market.chainId
        )}
        onCloseCollateralMenu={params.onCloseCollateralMenu}
        onCollateralChange={params.onCollateralChange}
        onMax={params.onMaxCollateral}
        onToggleCollateralMenu={params.onToggleCollateralMenu}
        selectedCollateral={
          COLLATERAL_OPTIONS.find(
            (option) =>
              option.chainId === params.market.chainId &&
              option.label === params.market.collateralLabel
          ) ?? COLLATERAL_OPTIONS[0]
        }
      />

      <div className="mt-4">
        <div className="text-numo-muted text-xs">Add to an existing vault</div>
        <div className="mt-2 rounded-2xl border border-numo-border bg-white px-4 py-3 text-numo-ink shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-semibold text-sm">Use Existing Vault</div>
              <div className="mt-1 text-numo-muted text-xs">{vaultLabel}</div>
              {params.vaultDiscoveryError ? (
                <div className="mt-1 text-numo-muted text-xs">{params.vaultDiscoveryError}</div>
              ) : null}
            </div>
            {params.vaultId ? <Check className="h-5 w-5 shrink-0 text-emerald-700" /> : null}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <div className="text-numo-muted text-xs">Receive</div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            className={cn(
              "rounded-2xl border px-3 py-2 text-left transition",
              params.receiveMode === "KESM_NOW"
                ? "border-numo-ink bg-numo-pill/40"
                : "border-numo-border bg-white hover:bg-numo-pill/40"
            )}
            onClick={() => params.onSelectReceiveMode("KESM_NOW")}
            type="button"
          >
            <div className="font-semibold text-numo-ink text-sm">
              {params.market.borrowLabel} now
            </div>
            <div className="text-numo-muted text-xs">Borrow and swap immediately</div>
          </button>
          <button
            className={cn(
              "rounded-2xl border px-3 py-2 text-left transition",
              params.receiveMode === "FY_KESM"
                ? "border-numo-ink bg-numo-pill/40"
                : "border-numo-border bg-white hover:bg-numo-pill/40"
            )}
            onClick={() => params.onSelectReceiveMode("FY_KESM")}
            type="button"
          >
            <div className="font-semibold text-numo-ink text-sm">{params.market.fyLabel}</div>
            <div className="text-numo-muted text-xs">Skip pool swap; swap later</div>
          </button>
        </div>
      </div>

      <SubmitSection
        canContinue={params.canSubmit}
        isSubmitting={params.isSubmitting}
        onSubmit={showPoolRecover ? params.onRecoverPool : params.onSubmit}
        primaryLabel={showPoolRecover ? "Fix Pool" : "Next Step"}
        secondaryAction={
          showPoolRecover ? { label: "Try Borrow Again", onClick: params.onSubmit } : null
        }
        submitError={params.submitError}
        txHash={params.txHash}
        txOutcome={params.txOutcome}
        txStatus={params.txStatus}
      />
    </>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Component orchestrates multi-step borrow UX and txn state.
export function BorrowFixedRate({ className, selectedChain }: BorrowFixedRateProps) {
  const userAddress = usePrivyAddress();
  const { chainId: connectedChainId, walletClient } = usePrivyWalletClient();

  const [step, setStep] = useState<BorrowStep>("borrow");
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [receiveMode, setReceiveMode] = useState<BorrowReceiveMode>("KESM_NOW");
  const [quoteFailureReason, setQuoteFailureReason] = useState<QuoteFailureReason | null>(null);
  const [token, setToken] = useState<TokenOption["id"]>("cNGN");
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
  const activeMarket = getMarketForToken(token);
  const maturityOptions = useBorrowMaturityOptions(activeMarket);
  const defaultMaturityId = maturityOptions[0]?.id ?? "";
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(defaultMaturityId);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);
  const [collateralMenuOpen, setCollateralMenuOpen] = useState(false);
  const collateralMenuRef = useRef<HTMLDivElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txOutcome, setTxOutcome] = useState<TxOutcome | null>(null);
  const defaultMarket = getMarketForToken("cNGN");
  if (!defaultMarket) {
    throw new Error("Default borrow market is missing.");
  }

  const { storageKey, vaultId, setVaultId } = useBorrowVaultId({
    ilkId: activeMarket?.ilkId ?? BORROW_CONFIG.ilk.usdt,
    seriesId: activeMarket?.seriesId ?? BORROW_CONFIG.seriesId.fyKesm,
    userAddress,
  });

  const discoveredVault = useBorrowVaultDiscovery({
    cauldronAddress: (activeMarket?.cauldron ?? BORROW_CONFIG.core.cauldron) as Address,
    ilkId: (activeMarket?.ilkId ?? BORROW_CONFIG.ilk.usdt) as Hex,
    seriesId: (activeMarket?.seriesId ?? BORROW_CONFIG.seriesId.fyKesm) as Hex,
    userAddress,
  });

  const { borrowDecimals, collateralAllowance, collateralBalance, collateralDecimals, refetch } =
    useBorrowWalletData({
      borrowToken:
        activeMarket?.borrowLabel === "cNGN"
          ? (BORROW_CONFIG.tokens.cNgn as Address)
          : (BORROW_CONFIG.tokens.kesm as Address),
      chainId: activeMarket?.chainId,
      collateralJoin: (activeMarket?.collateralJoin ?? BORROW_CONFIG.joins.usdt) as Address,
      collateralToken: (activeMarket?.collateralToken ?? BORROW_CONFIG.tokens.usdt) as Address,
      fyToken:
        activeMarket?.borrowLabel === "cNGN"
          ? (BORROW_CONFIG.tokens.fycNgn as Address)
          : (BORROW_CONFIG.tokens.fyKesm as Address),
      userAddress,
    });

  const { kesmPerUsdWad } = useKesmPerUsdRate();

  const parsedCollateral = safeParseAmount(collateralInput, collateralDecimals);
  const parsedBorrowKes = safeParseAmount(borrowInput, borrowDecimals);
  const collateralLabel = activeMarket?.collateralLabel ?? "USDT";

  const isSubmittingRef = useRef(false);
  useEffect(() => {
    isSubmittingRef.current = isSubmitting;
  }, [isSubmitting]);

  useEffect(() => {
    // Clear any previous "quote unavailable" style errors when inputs change.
    if (isSubmittingRef.current) {
      return;
    }
    void borrowInput;
    void collateralInput;
    void selectedMaturityId;
    void receiveMode;
    setQuoteFailureReason(null);
    setTxOutcome(null);
    setTxStatus(null);
    setTxHash(null);
  }, [borrowInput, collateralInput, receiveMode, selectedMaturityId]);

  useEffect(() => {
    // Once we know the real maturity id, select it unless the user already picked something else.
    if (
      (!selectedMaturityId || selectedMaturityId === "loading" || selectedMaturityId === "error") &&
      defaultMaturityId
    ) {
      setSelectedMaturityId(defaultMaturityId);
    }
  }, [defaultMaturityId, selectedMaturityId]);

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

  useDismissOnEscapeAndOutsideClick(tokenMenuOpen, tokenMenuRef, () => setTokenMenuOpen(false));
  useDismissOnEscapeAndOutsideClick(collateralMenuOpen, collateralMenuRef, () =>
    setCollateralMenuOpen(false)
  );

  const borrowStepError = getBorrowStepError(token, parsedBorrowKes);
  const selectedMaturity =
    maturityOptions.find((option) => option.id === selectedMaturityId) ?? maturityOptions[0];
  const maturitySelectionError =
    !selectedMaturityId || selectedMaturityId === "loading" || selectedMaturityId === "error"
      ? "Loading maturity…"
      : (selectedMaturity?.disabledReason ??
        (selectedMaturity?.disabled ? "Maturity unavailable." : null));
  const unsupportedMarketError = activeMarket ? null : "Borrowing this asset is not supported yet.";
  const borrowNextError = unsupportedMarketError ?? borrowStepError ?? maturitySelectionError;
  const canProceed = borrowNextError === null;

  const effectiveVaultId = vaultId ?? discoveredVault.vaultId;

  useEffect(() => {
    if (!vaultId && discoveredVault.vaultId) {
      setVaultId(discoveredVault.vaultId);
      if (typeof window !== "undefined" && storageKey) {
        window.localStorage.setItem(storageKey, discoveredVault.vaultId);
      }
    }
  }, [discoveredVault.vaultId, setVaultId, storageKey, vaultId]);

  const submitError =
    step !== "collateral"
      ? null
      : (() => {
          const validationError = getBorrowValidationError({
            borrow: parsedBorrowKes,
            collateral: parsedCollateral,
            collateralBalance,
            collateralLabel,
            token,
            userAddress,
            walletClient,
          });
          let networkError: string | null = null;
          if (activeMarket && connectedChainId !== activeMarket.chainId) {
            networkError = `Switch wallet network to ${getChainLabel(activeMarket.chainId)} (${activeMarket.chainId}).`;
          }
          const vaultError = effectiveVaultId ? null : "No existing vault found for this maturity.";
          return networkError ?? validationError ?? vaultError;
        })();
  const canSubmit = Boolean(selectedMaturityId) && !submitError && Boolean(activeMarket);

  return (
    <div className={cn("w-full", className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn("-inset-10 absolute rounded-3xl opacity-70 blur-3xl", "bg-neutral-200/60")}
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          {step === "borrow" ? (
            <BorrowStepView
              borrowInput={borrowInput}
              borrowStepError={borrowNextError}
              canProceed={canProceed}
              maturityOptions={maturityOptions}
              onBorrowChange={(value) => setBorrowInput(value)}
              onNext={() => {
                setQuoteFailureReason(null);
                setTxOutcome(null);
                setTxStatus(null);
                setTxHash(null);
                setStep("collateral");
              }}
              onSelectMaturity={(id) => setSelectedMaturityId(id)}
              onSelectToken={(id) => {
                setToken(id);
                setTokenMenuOpen(false);
              }}
              onToggleTokenMenu={() => setTokenMenuOpen((value) => !value)}
              selectedMaturityId={selectedMaturityId}
              selectedToken={selectedToken}
              token={token}
              tokenMenuOpen={tokenMenuOpen}
              tokenMenuRef={tokenMenuRef}
              tokenOptions={filteredTokens}
            />
          ) : (
            <CollateralStepView
              canSubmit={canSubmit}
              collateralBalance={collateralBalance}
              collateralDecimals={collateralDecimals}
              collateralInput={collateralInput}
              collateralizationPercent={computeCollateralizationPercent({
                collateral: parsedCollateral,
                collateralDecimals,
                debt: parsedBorrowKes,
                debtDecimals: borrowDecimals,
                kesmPerUsdWad: activeMarket?.borrowLabel === "KESm" ? kesmPerUsdWad : null,
              })}
              collateralMenuOpen={collateralMenuOpen}
              collateralMenuRef={collateralMenuRef}
              isSubmitting={isSubmitting}
              market={activeMarket ?? defaultMarket}
              onBack={() => setStep("borrow")}
              onCloseCollateralMenu={() => setCollateralMenuOpen(false)}
              onCollateralChange={(value) => setCollateralInput(value)}
              onMaxCollateral={() => {
                if (collateralBalance === null) {
                  return;
                }
                setCollateralInput(formatUnits(collateralBalance, collateralDecimals));
              }}
              onRecoverPool={() =>
                void handleRecoverPool({
                  market: activeMarket ?? defaultMarket,
                  setIsSubmitting,
                  setQuoteFailureReason,
                  setTxHash,
                  setTxOutcome,
                  setTxStatus,
                  userAddress,
                  walletClient,
                })
              }
              onSelectReceiveMode={(mode) => setReceiveMode(mode)}
              onSubmit={() => {
                if (!activeMarket) {
                  return;
                }
                void handleBorrowSubmit({
                  collateralAllowance,
                  connectedChainId,
                  market: activeMarket,
                  parsedBorrow: parsedBorrowKes,
                  parsedCollateral,
                  receiveMode,
                  refetch,
                  setIsSubmitting,
                  setQuoteFailureReason,
                  setTxHash,
                  setTxOutcome,
                  setTxStatus,
                  setVaultId,
                  storageKey,
                  submitError,
                  userAddress,
                  vaultId: effectiveVaultId,
                  walletClient,
                });
              }}
              onToggleCollateralMenu={() => setCollateralMenuOpen((value) => !value)}
              quoteFailureReason={quoteFailureReason}
              receiveMode={receiveMode}
              submitError={submitError}
              txHash={txHash}
              txOutcome={txOutcome}
              txStatus={txStatus}
              vaultDiscoveryError={discoveredVault.error}
              vaultDiscoveryStatus={discoveredVault.status}
              vaultId={effectiveVaultId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
