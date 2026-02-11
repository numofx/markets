"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { useKesmPerUsdRate } from "@/lib/useKesmPerUsdRate";
import { usePoolFeeApr } from "@/lib/usePoolFeeApr";
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { AddLiquidityModal } from "@/ui/AddLiquidityModal";
import { Button } from "@/ui/Button";
import { SmartLink } from "@/ui/SmartLink";

type PoolsCardProps = {
  className?: string;
};

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatUsd(value: number | null) {
  if (value === null) {
    return "—";
  }
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(1)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return USD_FORMAT.format(value);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "—";
  }
  return `${value.toFixed(2)}%`;
}

// `g1`/`g2` are 64.64 fixed point. Format fee using integer math in ppm (parts per million).
// 1% = 10_000 ppm, 0.01% = 100 ppm.
function formatFeePpmPercent(ppm: bigint | null) {
  if (ppm === null) {
    return null;
  }
  if (ppm < 0n) {
    return null;
  }

  // Truncate to 2 decimals in percent: 0.01% increments (1 bp).
  const bps = ppm / 100n;
  const whole = bps / 100n;
  const frac = (bps % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${frac}%`;
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

function wadToNumber(valueWad: bigint): number | null {
  const value = Number(valueWad) / 1e18;
  return Number.isFinite(value) ? value : null;
}

function computeYieldspaceFeeText(params: {
  g1: bigint | null;
  g2: bigint | null;
  fallback: string;
}) {
  const { g1, g2, fallback } = params;
  if (g1 === null || g2 === null) {
    return fallback;
  }
  if (g1 <= 0n || g2 <= 0n) {
    return fallback;
  }

  // Yieldspace fee encoding (64.64 fixed point):
  // feeSellBase ≈ 1 - (g1 / 2^64)
  // feeSellFYToken ≈ 1 - (2^64 / g2)
  const Q64 = 2n ** 64n;

  const sellBaseFeePpm = g1 < Q64 ? ((Q64 - g1) * 1_000_000n) / Q64 : 0n;
  const sellFyFeePpm = ((g2 - Q64) * 1_000_000n) / g2;

  const lowPpm = sellBaseFeePpm < sellFyFeePpm ? sellBaseFeePpm : sellFyFeePpm;
  const highPpm = sellBaseFeePpm > sellFyFeePpm ? sellBaseFeePpm : sellFyFeePpm;

  const lowText = formatFeePpmPercent(lowPpm);
  const highText = formatFeePpmPercent(highPpm);
  if (!(lowText && highText)) {
    return fallback;
  }

  return highPpm !== lowPpm ? `${lowText}-${highText}` : highText;
}

function formatMaturityDateLabel(maturitySeconds: number) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(maturitySeconds * 1000));
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 text-left">
      <div className="text-gray-500 text-xs">{label}</div>
      <div className="mt-1 font-semibold text-black text-sm">{value}</div>
    </div>
  );
}

export function PoolsCard({ className }: PoolsCardProps) {
  const [addLiquidityOpen, setAddLiquidityOpen] = useState(false);
  const userAddress = usePrivyAddress();
  const { maturity, poolBaseBalance, poolFyBalance, baseDecimals, fyDecimals, g1, g2 } =
    usePoolReads(userAddress);
  const { kesmPerUsdWad } = useKesmPerUsdRate();
  const { aprPercent: poolFeeAprPercent } = usePoolFeeApr();
  const poolName = `${CELO_YIELD_POOL.baseToken.symbol}/${CELO_YIELD_POOL.fyToken.symbol}`;
  const maturityLabel =
    typeof maturity === "number" && Number.isFinite(maturity)
      ? formatMaturityDateLabel(maturity)
      : "—";

  const tvlUsd = (() => {
    if (
      poolBaseBalance === null ||
      poolFyBalance === null ||
      baseDecimals === null ||
      fyDecimals === null ||
      kesmPerUsdWad === null ||
      kesmPerUsdWad <= 0n
    ) {
      return null;
    }

    const baseWad = toWad(poolBaseBalance, baseDecimals);
    const fyWad = toWad(poolFyBalance, fyDecimals);

    // Value FY token reserves using the pool's implied spot price (base per FY).
    const pWad = fyWad > 0n ? (baseWad * WAD) / fyWad : null;
    const fyValueInBaseWad = pWad ? (fyWad * pWad) / WAD : 0n;
    const totalBaseWad = baseWad + fyValueInBaseWad;

    // Convert KESm (base) to USD using the onchain oracle KESm/USD rate.
    const usdWad = (totalBaseWad * WAD) / kesmPerUsdWad;
    return wadToNumber(usdWad);
  })();

  const feeText = computeYieldspaceFeeText({
    fallback: CELO_YIELD_POOL.feeTier,
    g1,
    g2,
  });

  return (
    <div className={cn("w-full", className)}>
      <div className="relative mx-auto w-full max-w-md">
        <div
          aria-hidden="true"
          className="-inset-10 absolute rounded-3xl bg-neutral-200/60 opacity-70 blur-3xl"
        />

        <div className="relative rounded-3xl border border-numo-border bg-white/92 p-8 shadow-xl backdrop-blur">
          <header>
            <h1 className="font-semibold text-2xl text-black">Pools</h1>
            <p className="mt-1 text-gray-500 text-sm">Available yield pools on Celo.</p>
          </header>

          <div className="mt-8">
            <div className="rounded-2xl border border-numo-border bg-white px-5 py-5 text-left shadow-sm transition hover:bg-numo-pill/20">
              <div className="min-w-0">
                <div className="flex items-center gap-3">
                  <div className="-space-x-2 flex">
                    <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-numo-accent/10">
                      <Image
                        alt={CELO_YIELD_POOL.baseToken.symbol}
                        className="h-full w-full object-cover"
                        height={28}
                        src="/assets/KESm (Mento Kenyan Shilling).svg"
                        width={28}
                      />
                    </span>
                    <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border border-white bg-numo-ink/20">
                      <Image
                        alt={CELO_YIELD_POOL.fyToken.symbol}
                        className="h-full w-full object-cover"
                        height={28}
                        src="/assets/KESm (Mento Kenyan Shilling).svg"
                        width={28}
                      />
                    </span>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-black text-sm">{poolName}</div>
                    <SmartLink
                      className="mt-1 inline-block text-gray-500 text-xs underline-offset-2 hover:text-black"
                      href={CELO_YIELD_POOL.explorerUrl}
                    >
                      {shortAddress(CELO_YIELD_POOL.poolAddress)}
                    </SmartLink>
                  </div>
                </div>
              </div>

              <div className="mt-7 grid grid-cols-3 gap-6">
                <Metric label="APR" value={formatPercent(poolFeeAprPercent)} />
                <Metric label="TVL" value={formatUsd(tvlUsd)} />
                <Metric label="Maturity" value={maturityLabel} />
              </div>

              <div className="mt-5 text-gray-500 text-sm">Fee: {feeText}</div>

              <div className="mt-4">
                <Button
                  className="h-12 w-full rounded-2xl bg-black px-4 text-sm text-white hover:bg-neutral-800"
                  onClick={() => setAddLiquidityOpen(true)}
                  size="md"
                  type="button"
                  variant="primary"
                >
                  Add liquidity
                </Button>
              </div>
            </div>
          </div>

          <AddLiquidityModal
            feeText={feeText}
            onOpenChange={setAddLiquidityOpen}
            open={addLiquidityOpen}
          />
        </div>
      </div>
    </div>
  );
}
