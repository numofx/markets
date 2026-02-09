"use client";

import { Check, ChevronDown, Waves } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";
import { formatUnits, parseUnits } from "viem";
import { cn } from "@/lib/cn";
import { useBorrowVaultId } from "@/lib/useBorrowVaultId";
import { useBorrowWalletData } from "@/lib/useBorrowWalletData";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import { approveUsdtJoin, buildVault, pour, sellFyKes } from "@/src/borrow-actions";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { quoteFyForKes } from "@/src/borrow-quote";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type BorrowFixedRateProps = {
  className?: string;
};

type TokenOption = {
  id: "USDT" | "KESm";
  label: string;
  subtitle: string;
};

const TOKEN_ICON_SRC = {
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"], string>;

type MaturityOption = {
  id: string;
  apr: number;
  dateLabel: string;
  accent: "teal" | "violet" | "lime";
};

const TOKENS: TokenOption[] = [
  { id: "USDT", label: "USDT", subtitle: "Tether USD" },
  { id: "KESm", label: "KESm", subtitle: "Kenyan Shilling" },
];

const MATURITIES: MaturityOption[] = [
  { accent: "teal", apr: 31.32, dateLabel: "31 Dec 2021", id: "2021-12-31" },
  { accent: "violet", apr: 29.96, dateLabel: "31 Mar 2022", id: "2022-03-31" },
  { accent: "lime", apr: 59.12, dateLabel: "23 Jun 2022", id: "2022-06-23" },
];

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
  const numeric = Number.parseFloat(value);
  if (!value || Number.isNaN(numeric) || numeric <= 0) {
    return null;
  }
  try {
    return parseUnits(value, decimals);
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
  const needsApproval = params.allowance === null || params.allowance < params.collateral;
  if (needsApproval) {
    params.onStatus("Step 1/4: Approving USDT…");
    const approval = await approveUsdtJoin({
      account: params.account,
      amount: params.collateral,
      walletClient: params.walletClient,
    });
    params.onTxHash(approval.txHash);
  }

  let nextVaultId: Hex | null = params.vaultId;
  if (!nextVaultId) {
    params.onStatus("Step 2/4: Building vault…");
    const built = await buildVault({ account: params.account, walletClient: params.walletClient });
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
    throw new Error("Quote unavailable.");
  }

  params.onStatus("Step 3/4: Supplying collateral and borrowing…");
  const result = await pour({
    account: params.account,
    art: quote.fyToBorrow,
    ink: params.collateral,
    to: CELO_YIELD_POOL.poolAddress as Address,
    vaultId: nextVaultId,
    walletClient: params.walletClient,
  });
  params.onTxHash(result.txHash);

  const slippageBps = 50n;
  const minKesOut = (params.borrowKesDesired * (10_000n - slippageBps)) / 10_000n;
  params.onStatus("Step 4/4: Swapping fyKESm into KESm…");
  const swapResult = await sellFyKes({
    account: params.account,
    minKesOut,
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
}: {
  tokenLabel: string;
  selectedMaturityId: string;
  onSelectMaturity: (id: string) => void;
}) {
  return (
    <div className="mt-10">
      <div className="text-numo-muted text-xs">Available {tokenLabel}-based maturity dates</div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        {MATURITIES.slice(0, 2).map((option) => {
          const isSelected = option.id === selectedMaturityId;
          const accent = accentClasses(option.accent);
          return (
            <button
              className={cn(
                "flex items-center gap-3 rounded-2xl border border-numo-border bg-white px-4 py-4 text-left shadow-sm transition",
                isSelected ? "ring-2 ring-numo-ink/10" : "hover:bg-numo-pill/60"
              )}
              key={option.id}
              onClick={() => onSelectMaturity(option.id)}
              type="button"
            >
              <span
                className={cn("flex h-10 w-10 items-center justify-center rounded-full", accent)}
              >
                <Waves className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-numo-ink text-sm">
                  {option.apr.toFixed(2)}% <span className="font-medium text-numo-muted">APR</span>
                </div>
                <div className="mt-1 text-numo-muted text-xs">{option.dateLabel}</div>
              </div>
            </button>
          );
        })}

        {(() => {
          const option = MATURITIES[2];
          if (!option) {
            return null;
          }
          const isSelected = option.id === selectedMaturityId;
          return (
            <button
              className={cn(
                "col-span-2 flex items-center gap-4 rounded-2xl border border-numo-border px-5 py-4 text-left shadow-sm transition",
                isSelected
                  ? "bg-gradient-to-r from-lime-200 via-emerald-200 to-emerald-500/70"
                  : "bg-white hover:bg-numo-pill/60"
              )}
              onClick={() => onSelectMaturity(option.id)}
              type="button"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                <Waves className="h-6 w-6 text-emerald-700" />
              </span>
              <div className="min-w-0">
                <div className="font-semibold text-base text-numo-ink">
                  {option.apr.toFixed(2)}% <span className="font-medium text-numo-ink/70">APR</span>
                </div>
                <div className="mt-1 text-numo-ink/70 text-sm">{option.dateLabel}</div>
              </div>
            </button>
          );
        })()}
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
}: {
  collateralInput: string;
  onCollateralChange: (value: string) => void;
  usdtBalance: bigint | null;
  usdtDecimals: number;
  onMax: () => void;
}) {
  return (
    <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-numo-muted text-xs">Collateral (USDT)</div>
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

      {submitError ? <div className="mt-3 text-numo-muted text-xs">{submitError}</div> : null}

      {txStatus || txHash ? (
        <div className="mt-4 rounded-2xl border border-numo-border bg-white/80 px-4 py-3 text-numo-ink text-sm shadow-sm backdrop-blur">
          <div className="font-semibold">{txStatus ?? "Transaction submitted."}</div>
          {txHash ? <div className="mt-2 break-all text-numo-muted text-xs">{txHash}</div> : null}
        </div>
      ) : null}
    </>
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

export function BorrowFixedRate({ className }: BorrowFixedRateProps) {
  const userAddress = usePrivyAddress();
  const { isCelo, walletClient } = usePrivyWalletClient();

  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("KESm");
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(MATURITIES[2]?.id ?? "");
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const { storageKey, vaultId, setVaultId } = useBorrowVaultId({
    ilkId: BORROW_CONFIG.ilk.usdt,
    seriesId: BORROW_CONFIG.seriesId.fyKesm,
    userAddress,
  });

  const { kesDecimals, refetch, usdtAllowance, usdtBalance, usdtDecimals } = useBorrowWalletData({
    fyToken: BORROW_CONFIG.tokens.fyKesm as Address,
    kesToken: BORROW_CONFIG.tokens.kesm as Address,
    usdtJoin: BORROW_CONFIG.joins.usdt as Address,
    usdtToken: BORROW_CONFIG.tokens.usdt as Address,
    userAddress,
  });

  const parsedCollateral = safeParseAmount(collateralInput, usdtDecimals);
  const parsedBorrowKes = safeParseAmount(borrowInput, kesDecimals);

  const validationError = getBorrowValidationError({
    borrow: parsedBorrowKes,
    collateral: parsedCollateral,
    token,
    usdtBalance,
    userAddress,
    walletClient,
  });
  const networkError = isCelo ? null : "Switch wallet network to Celo (42220).";
  const submitError = networkError ?? validationError;
  const canContinue = !submitError && Boolean(selectedMaturityId);
  const selectedToken = TOKENS.find((t) => t.id === token) ?? TOKENS[0];

  useDismissOnEscapeAndOutsideClick(tokenMenuOpen, tokenMenuRef, () => setTokenMenuOpen(false));

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
          <header>
            <h2 className="bg-gradient-to-r from-teal-500 via-cyan-500 to-fuchsia-500 bg-clip-text font-semibold text-3xl text-transparent tracking-wide">
              BORROW
            </h2>
            <p className="mt-2 text-numo-muted text-sm">Borrow stablecoins at a fixed rate</p>
          </header>

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
                onChange={(event) => setBorrowInput(event.target.value)}
                placeholder={token === "KESm" ? "Enter amount" : "Coming soon"}
                value={borrowInput}
              />
            </div>

            <div className="relative" ref={tokenMenuRef}>
              <TokenDropdown
                onToggle={() => setTokenMenuOpen((value) => !value)}
                open={tokenMenuOpen}
                selected={selectedToken}
              />

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
                        onClick={() => {
                          setToken(option.id);
                          setTokenMenuOpen(false);
                        }}
                        role="menuitem"
                        type="button"
                      >
                        <span className="flex items-center gap-3">
                          <TokenIcon tokenId={option.id} />
                          <span className="flex flex-col">
                            <span className="font-semibold text-numo-ink text-sm">
                              {option.label}
                            </span>
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

          <CollateralCard
            collateralInput={collateralInput}
            onCollateralChange={(value) => setCollateralInput(value)}
            onMax={() => {
              if (usdtBalance === null) {
                return;
              }
              setCollateralInput(formatUnits(usdtBalance, usdtDecimals));
            }}
            usdtBalance={usdtBalance}
            usdtDecimals={usdtDecimals}
          />

          <MaturityGrid
            onSelectMaturity={(id) => setSelectedMaturityId(id)}
            selectedMaturityId={selectedMaturityId}
            tokenLabel={token}
          />

          <SubmitSection
            canContinue={canContinue}
            isSubmitting={isSubmitting}
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
                vaultId,
                walletClient,
              });
            }}
            submitError={submitError}
            txHash={txHash}
            txStatus={txStatus}
          />
        </div>
      </div>
    </div>
  );
}
