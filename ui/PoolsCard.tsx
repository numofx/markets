"use client";

import Image from "next/image";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { cn } from "@/lib/cn";

type PoolsCardProps = {
  className?: string;
};

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
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

export function PoolsCard({ className }: PoolsCardProps) {
  const poolName = `${CELO_YIELD_POOL.baseToken.symbol}/${CELO_YIELD_POOL.fyToken.symbol}`;

  return (
    <div
      className={cn(
        "w-full rounded-3xl border border-numo-border bg-white/80 p-6 shadow-lg backdrop-blur",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-numo-ink text-xl">Pools</h2>
          <p className="mt-1 text-numo-muted text-xs">Available yield pools on Celo.</p>
        </div>
        <span className="rounded-full border border-numo-border bg-numo-pill px-3 py-1 text-numo-muted text-xs">
          1 pool
        </span>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-numo-border bg-white shadow-sm">
        <table className="w-full min-w-[860px] text-left text-numo-muted text-xs">
          <thead className="border-numo-border/70 border-b bg-white">
            <tr className="text-[11px] text-numo-muted/70 uppercase tracking-[0.18em]">
              <th className="w-12 px-4 py-4 font-semibold">#</th>
              <th className="px-4 py-4 font-semibold">Pool</th>
              <th className="px-4 py-4 font-semibold">Fee</th>
              <th className="px-4 py-4 font-semibold">Maturity</th>
              <th className="px-4 py-4 text-right font-semibold">TVL</th>
              <th className="px-4 py-4 text-right font-semibold">Pool APR</th>
              <th className="px-4 py-4 text-right font-semibold">1D vol</th>
              <th className="px-4 py-4 text-right font-semibold">30D vol</th>
              <th className="px-4 py-4 text-right font-semibold">1D vol/TVL</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            <tr className="border-numo-border/50 border-b">
              <td className="px-4 py-5 font-semibold text-numo-ink">1</td>
              <td className="w-64 px-4 py-5">
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
                  <div>
                    <p className="font-semibold text-numo-ink">{poolName}</p>
                    <a
                      className="text-[11px] text-numo-muted underline-offset-2 hover:text-numo-ink"
                      href={CELO_YIELD_POOL.explorerUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {shortAddress(CELO_YIELD_POOL.poolAddress)}
                    </a>
                  </div>
                </div>
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-numo-ink">
                {CELO_YIELD_POOL.feeTier}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-numo-ink">
                {CELO_YIELD_POOL.maturityDate}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-right text-numo-ink">
                {formatUsd(CELO_YIELD_POOL.stats.tvlUsd)}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-right text-numo-ink">
                {formatPercent(CELO_YIELD_POOL.stats.poolApr)}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-right text-numo-ink">
                {formatUsd(CELO_YIELD_POOL.stats.oneDayVolumeUsd)}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-right text-numo-ink">
                {formatUsd(CELO_YIELD_POOL.stats.thirtyDayVolumeUsd)}
              </td>
              <td className="whitespace-nowrap px-4 py-5 text-right text-numo-ink">
                {CELO_YIELD_POOL.stats.oneDayVolumeOverTvl ?? "—"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
