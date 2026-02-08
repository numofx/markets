import { Filter } from "lucide-react";
import { cn } from "@/lib/cn";

type PositionsCardProps = {
  className?: string;
};

export function PositionsCard({ className }: PositionsCardProps) {
  return (
    <div className={cn("w-full", className)}>
      <section>
        <h2 className="font-semibold text-3xl text-numo-ink">Earn</h2>

        <div className="mt-4 rounded-3xl border border-numo-border bg-white/90 p-6 shadow-lg backdrop-blur">
          <p className="font-semibold text-numo-muted/70 text-xs uppercase tracking-[0.2em]">
            Your deposits
          </p>
          <p className="mt-2 font-semibold text-4xl text-numo-ink">$0.00</p>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-end gap-4 text-numo-muted text-xs">
          <button
            className="flex items-center gap-2 rounded-full border border-numo-border bg-white px-4 py-2 text-numo-ink/80 shadow-sm transition hover:text-numo-ink"
            type="button"
          >
            <Filter className="h-4 w-4" />
            Network: All
          </button>
          <button
            className="flex items-center gap-2 rounded-full border border-numo-border bg-white px-4 py-2 text-numo-ink/80 shadow-sm transition hover:text-numo-ink"
            type="button"
          >
            <Filter className="h-4 w-4" />
            Deposit: All
          </button>
        </div>

        <div className="mt-4 rounded-3xl border border-numo-border bg-white/90 p-10 text-center shadow-lg backdrop-blur">
          <p className="text-numo-muted text-sm">No active Earn positions.</p>
          <button
            className="mt-4 rounded-full bg-numo-ink px-5 py-2 font-semibold text-white text-xs shadow-sm transition hover:opacity-90"
            type="button"
          >
            Explore vaults
          </button>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="font-semibold text-3xl text-numo-ink">Borrow</h2>
        <div className="mt-4 rounded-3xl border border-numo-border bg-white/90 p-6 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center gap-3 font-semibold text-numo-muted text-xs">
            <span className="rounded-full bg-numo-pill px-3 py-1">Your loans</span>
            <span>Your collateral</span>
          </div>
          <p className="mt-3 font-semibold text-4xl text-numo-ink">$0.00</p>
        </div>
      </section>
    </div>
  );
}
