"use client";

import { ArrowLeft, Check, ChevronDown, Waves } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "viem";
import { cn } from "@/lib/cn";
import { usePoolReads } from "@/lib/usePoolReads";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";

type LendFixedRateProps = {
  className?: string;
};

type TokenOption = {
  id: "USDT" | "KESm";
  label: string;
};

type LendStep = "form" | "review";

const TOKEN_ICON_SRC = {
  KESm: "/assets/KESm%20(Mento%20Kenyan%20Shilling).svg",
  USDT: "/assets/usdt.svg",
} as const satisfies Record<TokenOption["id"], string>;

type MaturityOption = {
  id: string;
  aprText: string;
  dateLabel: string;
  accent: "teal" | "violet" | "lime";
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

function useLendMaturityOptions(token: TokenOption["id"]): MaturityOption[] {
  const { loading, maturity, poolBaseBalance, poolFyBalance } = usePoolReads();

  if (token !== "KESm") {
    return [];
  }

  if (loading) {
    return [{ accent: "lime", aprText: "—", dateLabel: "—", id: "loading" }];
  }

  if (
    maturity === null ||
    !Number.isFinite(maturity) ||
    poolBaseBalance === null ||
    poolFyBalance === null
  ) {
    return [{ accent: "lime", aprText: "—", dateLabel: "—", id: "error" }];
  }

  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timeRemaining = BigInt(maturity) - nowSeconds;

  const aprText =
    timeRemaining > 0n && poolFyBalance > 0n
      ? formatAprPercent(aprFromPriceWad((poolBaseBalance * WAD) / poolFyBalance, timeRemaining))
      : "—";

  return [
    {
      accent: "lime",
      aprText,
      dateLabel: formatMaturityDateLabel(maturity),
      id: `pool:${maturity}`,
    },
  ];
}

function accentClasses(accent: MaturityOption["accent"]) {
  switch (accent) {
    case "teal":
      return "text-teal-500 bg-teal-500/10";
    case "violet":
      return "text-fuchsia-500 bg-fuchsia-500/10";
    case "lime":
      return "text-emerald-700 bg-emerald-700/10";
  }
}

function isPositiveAmount(value: string) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0;
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
    <span className="inline-flex rounded-full bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-lime-300 p-0.5">
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-sm">
        <Image alt={`${tokenId} token icon`} height={20} src={TOKEN_ICON_SRC[tokenId]} width={20} />
      </span>
    </span>
  );
}

function LendReviewTransaction(props: {
  amount: string;
  canContinue: boolean;
  className?: string;
  maturityLabel: string;
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
          className={cn(
            "-inset-10 absolute rounded-3xl opacity-80 blur-3xl",
            "bg-gradient-to-br from-emerald-200 via-sky-200 to-rose-200"
          )}
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
                <div className="text-numo-muted text-xs">Effective APY</div>
                <div className="mt-1 font-semibold text-lg text-numo-ink">
                  {props.yieldLabel || "—"}
                </div>
              </div>
            </div>
          </div>

          <button
            className={cn(
              "mt-10 h-12 w-full rounded-2xl border border-numo-border font-semibold text-sm shadow-sm transition",
              props.canContinue
                ? "bg-gradient-to-r from-amber-400 via-fuchsia-500 to-emerald-400 text-white hover:opacity-95"
                : "bg-white text-numo-muted opacity-60"
            )}
            disabled={!props.canContinue}
            type="button"
          >
            Lend {props.amount || "—"} {props.tokenLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function LendFixedRate({ className }: LendFixedRateProps) {
  const { baseDecimals, poolBaseBalance, poolFyBalance } = usePoolReads();
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("KESm");
  const maturityOptions = useLendMaturityOptions(token);
  const [step, setStep] = useState<LendStep>("form");
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(
    maturityOptions[0]?.id ?? ""
  );
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextDefault = maturityOptions[0]?.id ?? "";
    if (!nextDefault) {
      setSelectedMaturityId("");
      return;
    }

    // If we were on a placeholder selection, advance to the real pool maturity once loaded.
    if (!selectedMaturityId || selectedMaturityId === "loading" || selectedMaturityId === "error") {
      setSelectedMaturityId(nextDefault);
      return;
    }

    // If the user selected something that no longer exists (e.g. token switch), reset to the default.
    if (!maturityOptions.some((option) => option.id === selectedMaturityId)) {
      setSelectedMaturityId(nextDefault);
    }
  }, [maturityOptions, selectedMaturityId]);

  const selectedMaturity =
    maturityOptions.find((option) => option.id === selectedMaturityId) ?? maturityOptions[0];

  const canContinue =
    token === "KESm" &&
    isPositiveAmount(amount) &&
    Boolean(selectedMaturity?.id) &&
    selectedMaturity?.id !== "loading" &&
    selectedMaturity?.id !== "error";
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

  useEffect(() => {
    if (!tokenMenuOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      setTokenMenuOpen(false);
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (tokenMenuRef.current?.contains(target)) {
        return;
      }
      setTokenMenuOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [tokenMenuOpen]);

  if (step === "review") {
    return (
      <LendReviewTransaction
        amount={amount}
        canContinue={canContinue}
        className={className}
        maturityLabel={selectedMaturity?.dateLabel ?? "—"}
        onBack={() => setStep("form")}
        redeemableAtMaturity={redeemableAtMaturity}
        tokenLabel={selectedToken.label}
        yieldLabel={selectedMaturity?.aprText ?? "—"}
      />
    );
  }

  return (
    <div className={cn("w-full", className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className={cn(
            "-inset-10 absolute rounded-3xl opacity-70 blur-3xl",
            "bg-gradient-to-b from-numo-cream via-amber-50 to-numo-sand"
          )}
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          <header>
            <h2 className="bg-gradient-to-r from-teal-500 via-cyan-500 to-fuchsia-500 bg-clip-text font-semibold text-3xl text-transparent tracking-wide">
              LEND
            </h2>
            <p className="mt-2 text-numo-muted text-sm">Lend stablecoins for predictable returns</p>
          </header>

          <div className="mt-8 flex items-center gap-3">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor="lend-amount">
                Amount
              </label>
              <input
                className={cn(
                  "h-12 w-full rounded-2xl border border-numo-border bg-white px-4 pr-14 text-numo-ink shadow-sm outline-none",
                  "placeholder:text-numo-border focus:border-numo-ink"
                )}
                id="lend-amount"
                inputMode="decimal"
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Enter amount"
                value={amount}
              />
              <button
                className="-translate-y-1/2 absolute top-1/2 right-3 rounded-full px-2 py-1 font-semibold text-numo-muted text-xs transition hover:bg-numo-pill/60"
                onClick={() => setAmount("0")}
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
                  "flex h-12 w-44 items-center justify-between gap-3 rounded-2xl border border-numo-border bg-white px-3 text-numo-ink shadow-sm",
                  "transition hover:bg-numo-pill/50"
                )}
                onClick={() => setTokenMenuOpen((value) => !value)}
                type="button"
              >
                <span className="flex items-center gap-3">
                  {selectedToken ? <TokenIcon tokenId={selectedToken.id} /> : null}
                  <span className="font-semibold text-sm">{selectedToken?.label}</span>
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
                    const isSelected = option.id === token;
                    return (
                      <button
                        className={cn(
                          "flex w-full items-center justify-between rounded-2xl px-3 py-3 text-left transition hover:bg-numo-pill/60",
                          isSelected ? "bg-numo-pill" : "bg-transparent"
                        )}
                        key={option.id}
                        onClick={() => {
                          setToken(option.id);
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
                        {isSelected ? <Check className="h-5 w-5 text-emerald-700" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mt-10">
            <div className="text-numo-muted text-xs">
              Select a {selectedToken?.label}-based maturity date
            </div>

            <div className="mt-4 grid grid-cols-2 gap-4">
              {maturityOptions.length === 0 ? (
                <div className="col-span-2 rounded-2xl border border-numo-border bg-white px-4 py-4 text-numo-muted text-sm shadow-sm">
                  No maturity dates available for {selectedToken.label} yet.
                </div>
              ) : null}
              {maturityOptions.map((option) => {
                const isSelected = option.id === selectedMaturityId;
                const accent = accentClasses(option.accent);
                return (
                  <button
                    className={cn(
                      "flex items-center gap-3 rounded-2xl border border-numo-border bg-white px-4 py-4 text-left shadow-sm transition",
                      maturityOptions.length === 1 ? "col-span-2" : "col-span-1",
                      isSelected ? "ring-2 ring-numo-ink/10" : "hover:bg-numo-pill/60"
                    )}
                    key={option.id}
                    onClick={() => setSelectedMaturityId(option.id)}
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
                      <div className="font-semibold text-numo-ink text-sm">
                        {option.aprText} <span className="font-medium text-numo-muted">APY</span>
                      </div>
                      <div className="mt-1 text-numo-muted text-xs">{option.dateLabel}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            className={cn(
              "mt-10 h-12 w-full rounded-2xl border border-numo-border bg-white font-semibold text-numo-muted text-sm",
              "shadow-sm transition",
              canContinue ? "text-numo-ink hover:bg-numo-pill/60" : "opacity-60"
            )}
            disabled={!canContinue}
            onClick={() => {
              if (!canContinue) {
                return;
              }
              setStep("review");
            }}
            type="button"
          >
            Next Step
          </button>
        </div>
      </div>
    </div>
  );
}
