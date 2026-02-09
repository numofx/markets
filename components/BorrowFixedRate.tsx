"use client";

import { Check, ChevronDown, Waves } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";

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

function isPositiveAmount(value: string) {
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) && numeric > 0;
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

export function BorrowFixedRate({ className }: BorrowFixedRateProps) {
  const [amount, setAmount] = useState("");
  const [token, setToken] = useState<TokenOption["id"]>("USDT");
  const [selectedMaturityId, setSelectedMaturityId] = useState<string>(MATURITIES[2]?.id ?? "");
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false);
  const tokenMenuRef = useRef<HTMLDivElement | null>(null);

  const selectedMaturity =
    MATURITIES.find((option) => option.id === selectedMaturityId) ?? MATURITIES[0];

  const canContinue = isPositiveAmount(amount) && Boolean(selectedMaturity?.id) && Boolean(token);
  const selectedToken = TOKENS.find((t) => t.id === token) ?? TOKENS[0];

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
                onChange={(event) => setAmount(event.target.value)}
                placeholder="Enter amount"
                value={amount}
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
                <div
                  className="absolute left-0 z-10 mt-3 w-80 rounded-3xl border border-numo-border bg-white p-3 shadow-xl"
                  role="menu"
                >
                  <div className="px-3 py-2 font-semibold text-numo-muted text-xs tracking-wide">
                    SELECT CURRENCY
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

          <div className="mt-10">
            <div className="text-numo-muted text-xs">Available {token}-based maturity dates</div>

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
                        {option.apr.toFixed(2)}%{" "}
                        <span className="font-medium text-numo-muted">APR</span>
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
                    onClick={() => setSelectedMaturityId(option.id)}
                    type="button"
                  >
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-sm">
                      <Waves className="h-6 w-6 text-emerald-700" />
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-base text-numo-ink">
                        {option.apr.toFixed(2)}%{" "}
                        <span className="font-medium text-numo-ink/70">APR</span>
                      </div>
                      <div className="mt-1 text-numo-ink/70 text-sm">{option.dateLabel}</div>
                    </div>
                  </button>
                );
              })()}
            </div>
          </div>

          <button
            className={cn(
              "mt-10 h-12 w-full rounded-2xl border border-numo-border bg-white font-semibold text-numo-muted text-sm",
              "shadow-sm transition",
              canContinue ? "text-numo-ink hover:bg-numo-pill/60" : "opacity-60"
            )}
            disabled={!canContinue}
            type="button"
          >
            Next Step
          </button>
        </div>
      </div>
    </div>
  );
}
