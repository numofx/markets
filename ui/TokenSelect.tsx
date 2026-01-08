"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

type TokenSelectProps = {
  symbol: string;
  label: string;
  className?: string;
};

export function TokenSelect({ symbol, label, className }: TokenSelectProps) {
  return (
    <button
      className={cn(
        "flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-2 font-semibold text-numo-ink text-sm shadow-sm",
        className,
      )}
      type="button"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-numo-accent/10 font-bold text-numo-accent text-xs">
        {symbol.slice(0, 2)}
      </span>
      <span>{label}</span>
      <ChevronDown className="h-4 w-4 text-numo-muted" />
    </button>
  );
}
