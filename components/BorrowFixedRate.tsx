"use client";

import { ArrowLeft, Check, ChevronDown, ThumbsDown, ThumbsUp, Waves } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";
import { formatUnits, parseUnits } from "viem";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { cn } from "@/lib/cn";
import { getRevertSelector } from "@/lib/get-revert-selector";
import { useBorrowVaultDiscovery } from "@/lib/useBorrowVaultDiscovery";
import { useBorrowVaultId } from "@/lib/useBorrowVaultId";
import { useBorrowWalletData } from "@/lib/useBorrowWalletData";
import { useKesmPerUsdRate } from "@/lib/useKesmPerUsdRate";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { approveUsdtJoin, buildVault, pour, sellFyKes } from "@/src/borrow-actions";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { quoteFyForKes } from "@/src/borrow-quote";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type BorrowFixedRateProps = {
  className?: string;
};

type BorrowStep = "borrow" | "collateral";

type TokenOption = {
  id: "USDT" | "KESm";
  label: string;
  subtitle: string;
};

type CollateralOption = {
  id: "USDT";
  label: string;
  subtitle: string;
};

const TOKEN_ICON_SRC = {
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"], string>;

type MaturityOption = {
  id: string;
  aprText: string;
  dateLabel: string;
  accent: "teal" | "violet" | "lime";
  disabled?: boolean;
  disabledReason?: string;
};

const TOKENS: TokenOption[] = [
  { id: "USDT", label: "USDT", subtitle: "Tether USD" },
  { id: "KESm", label: "KESm", subtitle: "Kenyan Shilling" },
];

const COLLATERAL_OPTIONS: CollateralOption[] = [
  { id: "USDT", label: "USDT", subtitle: "Tether USD" },
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

const U128_MAX = BigInt("340282366920938463463374607431768211455");

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
  poolBaseBalance: bigint;
  poolFyBalance: bigint;
};

async function readBorrowAprContext(poolAddress: Address): Promise<BorrowAprContext> {
  const [baseToken, fyToken, maturity, poolBaseBalance, poolFyBalance] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { abi: poolAbi, address: poolAddress, functionName: "baseToken" },
        { abi: poolAbi, address: poolAddress, functionName: "fyToken" },
        { abi: poolAbi, address: poolAddress, functionName: "maturity" },
        { abi: poolAbi, address: poolAddress, functionName: "getBaseBalance" },
        { abi: poolAbi, address: poolAddress, functionName: "getFYTokenBalance" },
      ],
    });

  const [baseDecimals, fyDecimals] = await publicClient.multicall({
    allowFailure: false,
    contracts: [
      { abi: erc20Abi, address: baseToken, functionName: "decimals" },
      { abi: erc20Abi, address: fyToken, functionName: "decimals" },
    ],
  });

  return {
    baseDecimals: Number(baseDecimals),
    fyDecimals: Number(fyDecimals),
    maturitySeconds: Number(maturity),
    poolAddress,
    poolBaseBalance,
    poolFyBalance,
  };
}

async function quoteAprFromTinySellBasePreview(params: {
  baseDecimals: number;
  fyDecimals: number;
  poolAddress: Address;
  poolBaseBalance: bigint;
  poolFyBalance: bigint;
  timeRemaining: bigint;
}) {
  if (params.timeRemaining <= 0n || params.poolFyBalance <= 0n) {
    return { aprText: "—", disabled: false, disabledReason: undefined };
  }

  try {
    const baseUnit = 10n ** BigInt(params.baseDecimals);
    const baseIn = baseUnit / 1000n || 1n;
    if (baseIn <= U128_MAX) {
      const fyOut = await publicClient.readContract({
        abi: poolAbi,
        address: params.poolAddress,
        args: [baseIn],
        functionName: "sellBasePreview",
      });

      if (fyOut > 0n) {
        const pWad = (toWad(baseIn, params.baseDecimals) * WAD) / toWad(fyOut, params.fyDecimals);
        return {
          aprText: formatAprPercent(aprFromPriceWad(pWad, params.timeRemaining)),
          disabled: false,
          disabledReason: undefined,
        };
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

  const pWad =
    (toWad(params.poolBaseBalance, params.baseDecimals) * WAD) /
    toWad(params.poolFyBalance, params.fyDecimals);
  return {
    aprText: formatAprPercent(aprFromPriceWad(pWad, params.timeRemaining)),
    disabled: false,
    disabledReason: undefined,
  };
}

async function fetchBorrowMaturityOption(): Promise<MaturityOption> {
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;
  const ctx = await readBorrowAprContext(poolAddress);
  const maturitySeconds = ctx.maturitySeconds;
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timeRemaining = BigInt(maturitySeconds) - nowSeconds;

  const quote = await quoteAprFromTinySellBasePreview({
    baseDecimals: ctx.baseDecimals,
    fyDecimals: ctx.fyDecimals,
    poolAddress: ctx.poolAddress,
    poolBaseBalance: ctx.poolBaseBalance,
    poolFyBalance: ctx.poolFyBalance,
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

function useBorrowMaturityOptions(): MaturityOption[] {
  const [options, setOptions] = useState<MaturityOption[]>([
    { accent: "lime", aprText: "—", dateLabel: "—", id: "loading" },
  ]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const next: MaturityOption[] = [await fetchBorrowMaturityOption()];
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
  }, []);

  return options;
}

function accentClasses(accent: MaturityOption["accent"]) {
  switch (accent) {
    case "teal":
      return "text-teal-500 bg-teal-500/10";
    case "violet":
      return "text-fuchsia-500 bg-fuchsia-500/10";
    case "lime":
      return "text-emerald-700 bg-white";
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
  usdtBalance: bigint | null;
  token: TokenOption["id"];
}) {
  if (!params.userAddress) {
    return "Connect wallet to continue.";
  }
  if (!params.walletClient) {
    return "Wallet client unavailable.";
  }
  if (params.token !== "KESm") {
    return "Borrowing USDT is not supported yet.";
  }
  if (!(params.collateral && params.borrow)) {
    return "Enter collateral and borrow amounts.";
  }
  if (params.usdtBalance !== null && params.collateral > params.usdtBalance) {
    return "Insufficient USDT balance.";
  }
  return null;
}

function TokenIcon({ tokenId }: { tokenId: TokenOption["id"] }) {
  return (
    <span className="inline-flex rounded-full bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-300 p-0.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
        <Image alt={`${tokenId} token icon`} height={20} src={TOKEN_ICON_SRC[tokenId]} width={20} />
      </span>
    </span>
  );
}

function CollateralIcon({ collateralId }: { collateralId: CollateralOption["id"] }) {
  return (
    <span className="inline-flex rounded-full bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-300 p-0.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
        <Image
          alt={`${collateralId} token icon`}
          height={20}
          src={TOKEN_ICON_SRC[collateralId]}
          width={20}
        />
      </span>
    </span>
  );
}

function quoteUnavailableHint(reason: string | undefined) {
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
  collateral: bigint;
  borrowKesDesired: bigint;
  allowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  onStatus: (status: string) => void;
  onTxHash: (hash: Hex) => void;
  persistVaultId: (vaultId: Hex) => void;
}) {
  // Privy/wallet providers can occasionally race nonces for multi-tx flows.
  // We manage nonces ourselves to keep tx ordering deterministic.
  let nextNonce = await publicClient.getTransactionCount({
    address: params.account,
    blockTag: "pending",
  });

  const needsApproval = params.allowance === null || params.allowance < params.collateral;
  if (needsApproval) {
    params.onStatus("Step 1/4: Approving USDT…");
    const approval = await approveUsdtJoin({
      account: params.account,
      amount: params.collateral,
      nonce: nextNonce,
      walletClient: params.walletClient,
    });
    nextNonce += 1;
    params.onTxHash(approval.txHash);
  }

  let nextVaultId: Hex | null = params.vaultId;
  if (!nextVaultId) {
    params.onStatus("Step 2/4: Building vault…");
    const built = await buildVault({
      account: params.account,
      nonce: nextNonce,
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

  const quote = await quoteFyForKes(params.borrowKesDesired);
  if (quote.fyToBorrow <= 0n) {
    throw new Error(`Quote unavailable. ${quoteUnavailableHint(quote.reason)}`);
  }

  params.onStatus("Step 3/4: Supplying collateral and borrowing…");
  const result = await pour({
    account: params.account,
    art: quote.fyToBorrow,
    ink: params.collateral,
    nonce: nextNonce,
    to: CELO_YIELD_POOL.poolAddress as Address,
    vaultId: nextVaultId,
    walletClient: params.walletClient,
  });
  nextNonce += 1;
  params.onTxHash(result.txHash);

  const slippageBps = 50n;
  const minKesOut = (params.borrowKesDesired * (10_000n - slippageBps)) / 10_000n;
  params.onStatus("Step 4/4: Swapping fyKESm into KESm…");
  const swapResult = await sellFyKes({
    account: params.account,
    minKesOut,
    nonce: nextNonce,
    walletClient: params.walletClient,
  });
  nextNonce += 1;
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
        {selected ? <TokenIcon tokenId={selected.id} /> : null}
        <span className="font-semibold text-sm">{selected?.label}</span>
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
      const backgroundClass = isSelected
        ? "bg-gradient-to-r from-lime-200 via-emerald-200 to-emerald-500/70"
        : "bg-white";
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
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
            <Waves className="h-6 w-6 text-emerald-700" />
          </span>
          <div className="min-w-0">
            <div className="font-semibold text-base text-numo-ink">
              {option.aprText} <span className="font-medium text-numo-ink/70">APR</span>
            </div>
            <div className="mt-1 text-numo-ink/70 text-sm">{dateLine}</div>
          </div>
        </button>
      );
    }

    return (
      <button
        className={cn(
          "flex items-center gap-3 rounded-2xl border border-numo-border bg-white px-4 py-4 text-left shadow-sm transition",
          isSelected ? "ring-2 ring-numo-ink/10" : "",
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
          <div className="font-semibold text-numo-ink text-sm">
            {option.aprText} <span className="font-medium text-numo-muted">APR</span>
          </div>
          <div className="mt-1 text-numo-muted text-xs">{dateLine}</div>
        </div>
      </button>
    );
  };

  return (
    <div className="mt-10">
      <div className="text-numo-muted text-xs">Available {tokenLabel}-based maturity dates</div>

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
  usdtBalance,
  usdtDecimals,
  onMax,
  collateralMenuOpen,
  collateralMenuRef,
  onToggleCollateralMenu,
  onCloseCollateralMenu,
}: {
  collateralInput: string;
  onCollateralChange: (value: string) => void;
  usdtBalance: bigint | null;
  usdtDecimals: number;
  onMax: () => void;
  collateralMenuOpen: boolean;
  collateralMenuRef: React.RefObject<HTMLDivElement | null>;
  onToggleCollateralMenu: () => void;
  onCloseCollateralMenu: () => void;
}) {
  const selectedCollateral = COLLATERAL_OPTIONS[0];
  return (
    <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-numo-muted text-xs">Collateral</div>
          <input
            className="mt-2 w-full bg-transparent text-lg text-numo-ink outline-none placeholder:text-numo-border"
            inputMode="decimal"
            onChange={(event) => onCollateralChange(event.target.value)}
            placeholder="0"
            value={collateralInput}
          />
          <div className="mt-1 text-numo-muted text-xs">
            Balance: {usdtBalance === null ? "—" : `${formatUnits(usdtBalance, usdtDecimals)} USDT`}
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="relative" ref={collateralMenuRef}>
            <button
              aria-expanded={collateralMenuOpen}
              aria-haspopup="menu"
              className={cn(
                "flex h-12 w-40 items-center justify-between gap-2 rounded-full border border-numo-border bg-white px-3 text-numo-ink shadow-sm",
                "transition hover:bg-numo-pill/50"
              )}
              onClick={onToggleCollateralMenu}
              type="button"
            >
              <span className="flex items-center gap-2">
                <CollateralIcon collateralId={selectedCollateral.id} />
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
                {COLLATERAL_OPTIONS.map((option) => (
                  <button
                    className={cn(
                      "flex w-full items-center justify-between rounded-2xl bg-numo-pill px-3 py-3 text-left text-numo-ink transition hover:bg-numo-pill/60"
                    )}
                    key={option.id}
                    onClick={() => onCloseCollateralMenu()}
                    type="button"
                  >
                    <span className="flex items-center gap-3">
                      <CollateralIcon collateralId={option.id} />
                      <span className="flex flex-col">
                        <span className="font-semibold text-numo-ink text-sm">{option.label}</span>
                        <span className="text-numo-muted text-sm">{option.subtitle}</span>
                      </span>
                    </span>
                    <Check className="h-5 w-5 text-emerald-700" />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <button
            className="rounded-full bg-numo-pill px-3 py-2 font-semibold text-numo-ink text-xs transition hover:opacity-90 disabled:opacity-50"
            disabled={usdtBalance === null}
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

function SubmitSection({
  canContinue,
  isSubmitting,
  onSubmit,
  submitError,
  txHash,
  txStatus,
}: {
  canContinue: boolean;
  isSubmitting: boolean;
  onSubmit: () => void;
  submitError: string | null;
  txHash: Hex | null;
  txStatus: string | null;
}) {
  // If we don't have a tx hash, treat txStatus as an error/notice and render it inline.
  // The "status card" is reserved for in-flight / submitted transactions.
  const inlineStatus = txHash ? null : txStatus;
  return (
    <>
      <button
        className={cn(
          "mt-10 h-12 w-full rounded-2xl border border-numo-border bg-white font-semibold text-numo-muted text-sm",
          "shadow-sm transition",
          canContinue ? "text-numo-ink hover:bg-numo-pill/60" : "opacity-60"
        )}
        disabled={!canContinue || isSubmitting}
        onClick={onSubmit}
        type="button"
      >
        {isSubmitting ? "Submitting…" : "Next Step"}
      </button>

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
  onToggleTokenMenu,
  onSelectToken,
  token,
}: {
  borrowInput: string;
  onBorrowChange: (value: string) => void;
  tokenMenuOpen: boolean;
  tokenMenuRef: React.RefObject<HTMLDivElement | null>;
  selectedToken: TokenOption | undefined;
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
            "h-12 w-full rounded-2xl border border-numo-border bg-white px-4 text-numo-ink shadow-sm outline-none",
            "placeholder:text-numo-border focus:border-numo-ink"
          )}
          id="borrow-amount"
          inputMode="decimal"
          onChange={(event) => onBorrowChange(event.target.value)}
          placeholder={token === "KESm" ? "Enter amount" : "Coming soon"}
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
            {TOKENS.map((option) => {
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
                    <TokenIcon tokenId={option.id} />
                    <span className="flex flex-col">
                      <span className="font-semibold text-numo-ink text-sm">{option.label}</span>
                      <span className="text-numo-muted text-sm">{option.subtitle}</span>
                    </span>
                  </span>
                  {isSelected ? <Check className="h-5 w-5 text-emerald-700" /> : null}
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
  isCelo: boolean;
  submitError: string | null;
  parsedCollateral: bigint | null;
  parsedBorrowKes: bigint | null;
}) {
  if (!params.isCelo) {
    return "Switch wallet network to Celo (42220).";
  }
  if (params.submitError) {
    return params.submitError;
  }
  if (!(params.parsedCollateral && params.parsedBorrowKes)) {
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

function getBorrowStepError(token: TokenOption["id"], parsedBorrowKes: bigint | null) {
  if (token !== "KESm") {
    return "Borrowing USDT is not supported yet.";
  }
  if (!parsedBorrowKes) {
    return "Enter amount to borrow.";
  }
  return null;
}

async function submitBorrowTx(params: {
  account: Address;
  walletClient: WalletClient;
  parsedCollateral: bigint;
  parsedBorrowKes: bigint;
  usdtAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  onStatus: (status: string) => void;
  onTxHash: (hash: Hex) => void;
  persistVaultId: (vaultId: Hex) => void;
}) {
  try {
    const flow = await runBorrowFlow({
      account: params.account,
      allowance: params.usdtAllowance,
      borrowKesDesired: params.parsedBorrowKes,
      collateral: params.parsedCollateral,
      onStatus: params.onStatus,
      onTxHash: params.onTxHash,
      persistVaultId: params.persistVaultId,
      storageKey: params.storageKey,
      vaultId: params.vaultId,
      walletClient: params.walletClient,
    });
    return { ok: true as const, vaultId: flow.vaultId };
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Borrow failed.";
    return { message, ok: false as const };
  }
}

async function handleBorrowSubmit(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  isCelo: boolean;
  submitError: string | null;
  parsedCollateral: bigint | null;
  parsedBorrowKes: bigint | null;
  usdtAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  setIsSubmitting: (value: boolean) => void;
  setTxStatus: (value: string | null) => void;
  setTxHash: (value: Hex | null) => void;
  setVaultId: (value: Hex | null) => void;
  refetch: (address: Address) => Promise<void>;
}) {
  if (!(params.userAddress && params.walletClient)) {
    return;
  }

  const preflightError = getPreflightError({
    isCelo: params.isCelo,
    parsedBorrowKes: params.parsedBorrowKes,
    parsedCollateral: params.parsedCollateral,
    submitError: params.submitError,
  });
  if (preflightError) {
    params.setTxStatus(preflightError);
    return;
  }

  const collateral = params.parsedCollateral as bigint;
  const borrowKesDesired = params.parsedBorrowKes as bigint;

  params.setIsSubmitting(true);
  params.setTxStatus(null);
  params.setTxHash(null);

  const result = await submitBorrowTx({
    account: params.userAddress,
    onStatus: (status) => params.setTxStatus(status),
    onTxHash: (hash) => params.setTxHash(hash),
    parsedBorrowKes: borrowKesDesired,
    parsedCollateral: collateral,
    persistVaultId: (next) => params.setVaultId(next),
    storageKey: params.storageKey,
    usdtAllowance: params.usdtAllowance,
    vaultId: params.vaultId,
    walletClient: params.walletClient,
  });

  if (!result.ok) {
    params.setTxStatus(result.message);
    params.setIsSubmitting(false);
    return;
  }

  params.setTxStatus("Position updated.");
  params.setVaultId(result.vaultId);
  await params.refetch(params.userAddress);
  params.setIsSubmitting(false);
}

function BorrowStepView(params: {
  borrowInput: string;
  onBorrowChange: (value: string) => void;
  token: TokenOption["id"];
  selectedToken: TokenOption | undefined;
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
        <h2 className="bg-gradient-to-r from-teal-500 via-cyan-500 to-fuchsia-500 bg-clip-text font-semibold text-3xl text-transparent tracking-wide">
          BORROW
        </h2>
        <p className="mt-2 text-numo-muted text-sm">Borrow stablecoins at a fixed rate</p>
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
        submitError={params.borrowStepError}
        txHash={null}
        txStatus={null}
      />
    </>
  );
}

function CollateralStepView(params: {
  collateralInput: string;
  onCollateralChange: (value: string) => void;
  usdtBalance: bigint | null;
  usdtDecimals: number;
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
  isSubmitting: boolean;
  onSubmit: () => void;
  submitError: string | null;
  txHash: Hex | null;
  txStatus: string | null;
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
        collateralInput={params.collateralInput}
        collateralMenuOpen={params.collateralMenuOpen}
        collateralMenuRef={params.collateralMenuRef}
        onCloseCollateralMenu={params.onCloseCollateralMenu}
        onCollateralChange={params.onCollateralChange}
        onMax={params.onMaxCollateral}
        onToggleCollateralMenu={params.onToggleCollateralMenu}
        usdtBalance={params.usdtBalance}
        usdtDecimals={params.usdtDecimals}
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

      <SubmitSection
        canContinue={params.canSubmit}
        isSubmitting={params.isSubmitting}
        onSubmit={params.onSubmit}
        submitError={params.submitError}
        txHash={params.txHash}
        txStatus={params.txStatus}
      />
    </>
  );
}

export function BorrowFixedRate({ className }: BorrowFixedRateProps) {
  const userAddress = usePrivyAddress();
  const { isCelo, walletClient } = usePrivyWalletClient();

  const [step, setStep] = useState<BorrowStep>("borrow");
  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("KESm");
  const maturityOptions = useBorrowMaturityOptions();
  const defaultMaturityId = maturityOptions[0]?.id ?? "";
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(defaultMaturityId);
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);
  const [collateralMenuOpen, setCollateralMenuOpen] = useState(false);
  const collateralMenuRef = useRef<HTMLDivElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const { storageKey, vaultId, setVaultId } = useBorrowVaultId({
    ilkId: BORROW_CONFIG.ilk.usdt,
    seriesId: BORROW_CONFIG.seriesId.fyKesm,
    userAddress,
  });

  const discoveredVault = useBorrowVaultDiscovery({
    cauldronAddress: BORROW_CONFIG.core.cauldron as Address,
    ilkId: BORROW_CONFIG.ilk.usdt as Hex,
    seriesId: BORROW_CONFIG.seriesId.fyKesm as Hex,
    userAddress,
  });

  const { kesDecimals, refetch, usdtAllowance, usdtBalance, usdtDecimals } = useBorrowWalletData({
    fyToken: BORROW_CONFIG.tokens.fyKesm as Address,
    kesToken: BORROW_CONFIG.tokens.kesm as Address,
    usdtJoin: BORROW_CONFIG.joins.usdt as Address,
    usdtToken: BORROW_CONFIG.tokens.usdt as Address,
    userAddress,
  });

  const { kesmPerUsdWad } = useKesmPerUsdRate();

  const parsedCollateral = safeParseAmount(collateralInput, usdtDecimals);
  const parsedBorrowKes = safeParseAmount(borrowInput, kesDecimals);

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
    setTxStatus(null);
    setTxHash(null);
  }, [borrowInput, collateralInput, selectedMaturityId]);

  useEffect(() => {
    // Once we know the real maturity id, select it unless the user already picked something else.
    if (
      (!selectedMaturityId || selectedMaturityId === "loading" || selectedMaturityId === "error") &&
      defaultMaturityId
    ) {
      setSelectedMaturityId(defaultMaturityId);
    }
  }, [defaultMaturityId, selectedMaturityId]);

  const selectedToken = TOKENS.find((t) => t.id === token) ?? TOKENS[0];

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
  const borrowNextError = borrowStepError ?? maturitySelectionError;
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
            token,
            usdtBalance,
            userAddress,
            walletClient,
          });
          const networkError = isCelo ? null : "Switch wallet network to Celo (42220).";
          const vaultError = effectiveVaultId ? null : "No existing vault found for this maturity.";
          return networkError ?? validationError ?? vaultError;
        })();
  const canSubmit = Boolean(selectedMaturityId) && !submitError;

  return (
    <div className={cn("w-full", className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn(
            "-inset-10 absolute rounded-3xl opacity-70 blur-3xl",
            "bg-gradient-to-b from-numo-cream via-amber-50 to-emerald-200/70"
          )}
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
            />
          ) : (
            <CollateralStepView
              canSubmit={canSubmit}
              collateralInput={collateralInput}
              collateralizationPercent={computeCollateralizationPercent({
                collateral: parsedCollateral,
                collateralDecimals: usdtDecimals,
                debt: parsedBorrowKes,
                debtDecimals: kesDecimals,
                kesmPerUsdWad,
              })}
              collateralMenuOpen={collateralMenuOpen}
              collateralMenuRef={collateralMenuRef}
              isSubmitting={isSubmitting}
              onBack={() => setStep("borrow")}
              onCloseCollateralMenu={() => setCollateralMenuOpen(false)}
              onCollateralChange={(value) => setCollateralInput(value)}
              onMaxCollateral={() => {
                if (usdtBalance === null) {
                  return;
                }
                setCollateralInput(formatUnits(usdtBalance, usdtDecimals));
              }}
              onSubmit={() => {
                void handleBorrowSubmit({
                  isCelo,
                  parsedBorrowKes,
                  parsedCollateral,
                  refetch,
                  setIsSubmitting,
                  setTxHash,
                  setTxStatus,
                  setVaultId,
                  storageKey,
                  submitError,
                  usdtAllowance,
                  userAddress,
                  vaultId: effectiveVaultId,
                  walletClient,
                });
              }}
              onToggleCollateralMenu={() => setCollateralMenuOpen((value) => !value)}
              submitError={submitError}
              txHash={txHash}
              txStatus={txStatus}
              usdtBalance={usdtBalance}
              usdtDecimals={usdtDecimals}
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
