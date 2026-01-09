"use client";

import { ChevronLeft, Info } from "lucide-react";
import { cn } from "@/lib/cn";
import { AssetSelect } from "@/ui/AssetSelect";
import { PillTabs } from "@/ui/PillTabs";
import { TokenSelect } from "@/ui/TokenSelect";

type LoanCardProps = {
  className?: string;
};

export function LoanCard({ className }: LoanCardProps) {
  return (
    <div
      className={cn(
        "w-full max-w-md rounded-3xl border border-numo-border bg-numo-card p-6 shadow-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <PillTabs defaultValue="Borrow" size="sm" tabs={["Borrow", "Lend"]} />
      </div>

      <div className="mt-6 rounded-2xl border border-numo-border bg-white p-4">
        <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">Borrow</div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <input
            aria-label="Borrow amount"
            className="w-full bg-transparent font-semibold text-3xl text-numo-ink outline-none"
            inputMode="decimal"
            placeholder="0"
            type="text"
          />
          <AssetSelect
            options={[
              { code: "USD", flagSrc: "/flags/us.svg", name: "US Dollar" },
              { code: "KES", flagSrc: "/flags/ke.svg", name: "Kenyan Shilling" },
            ]}
          />
        </div>
        <div className="mt-2 text-numo-muted text-xs">$0.00</div>
      </div>

      <div className="mt-4 rounded-2xl border border-numo-border bg-white p-4">
        <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">Collateral</div>
        <div className="mt-3 flex items-center justify-between gap-4">
          <input
            aria-label="Collateral amount"
            className="w-full bg-transparent font-semibold text-3xl text-numo-ink outline-none"
            inputMode="decimal"
            placeholder="0"
            type="text"
          />
          <AssetSelect
            options={[
              { code: "USD", flagSrc: "/flags/us.svg", name: "US Dollar" },
              { code: "KES", flagSrc: "/flags/ke.svg", name: "Kenyan Shilling" },
            ]}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-numo-muted text-xs">
          <span>$0.00</span>
          <span>456.12k WBTC</span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-numo-border bg-white p-4">
        <div className="flex items-center justify-between font-semibold text-numo-muted text-xs uppercase tracking-wide">
          <span>LTV</span>
          <span className="flex items-center gap-1 font-medium text-numo-muted text-xs">
            Liquidation price
            <Info className="h-3 w-3" />
            $0.00
          </span>
        </div>
        <input
          className="mt-4 w-full accent-numo-ink"
          defaultValue={35}
          max={85}
          min={1}
          step={1}
          type="range"
        />
        <div className="mt-2 grid grid-cols-5 text-numo-muted text-xs">
          <span>1%</span>
          <span className="text-center">25%</span>
          <span className="text-center">50%</span>
          <span className="text-center">75%</span>
          <span className="text-right">85%</span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-numo-border bg-white p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">Initial Term</div>
            <div className="mt-2 rounded-2xl border border-numo-border bg-numo-pill px-3 py-2 font-semibold text-numo-ink text-sm">
              <div>Oct 31</div>
              <div className="font-medium text-numo-muted text-xs">
                10 days term, auto-renewed
              </div>
            </div>
          </div>
          <PillTabs defaultValue="Market" size="sm" tabs={["Market", "Limit"]} />
        </div>
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-numo-border bg-numo-pill px-4 py-3 text-sm">
          <div className="font-semibold text-numo-ink">6.00%</div>
          <div className="text-numo-muted text-xs">Fixed APR · Net rate 4.75%</div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted"
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          className="flex-1 rounded-full bg-numo-ink px-4 py-3 font-semibold text-sm text-white"
          type="button"
        >
          Review Order
        </button>
      </div>

      <p className="mt-4 text-center text-numo-muted text-xs">
        By executing a transaction, you accept the User Agreement.
      </p>
    </div>
  );
}
