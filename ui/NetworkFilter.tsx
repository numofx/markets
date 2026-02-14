"use client";

import { Check, ChevronDown } from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/cn";

type ChainId = number;

type NetworkFilterProps = {
  chainIds: ChainId[];
  selectedChain: ChainId | null;
  includeAllNetworks?: boolean;
  hideArrow?: boolean;
  onPressChain: (chainId: ChainId | null) => void;
  className?: string;
  chainLabels?: Partial<Record<ChainId, string>>;
};

const DEFAULT_CHAIN_LABELS: Record<number, string> = {
  8453: "Base",
  42161: "Arbitrum",
  42220: "Celo",
  44787: "Alfajores",
};

function getChainLabel(chainId: ChainId, chainLabels?: Partial<Record<ChainId, string>>) {
  return chainLabels?.[chainId] ?? DEFAULT_CHAIN_LABELS[chainId] ?? `Chain ${chainId}`;
}

function NetworkIcon({ chainId }: { chainId: ChainId }) {
  if (chainId === 42_220) {
    return <Image alt="Celo" height={14} src="/assets/celo.svg" width={14} />;
  }
  if (chainId === 8453) {
    return <Image alt="Base" height={14} src="/assets/base.svg" width={14} />;
  }
  if (chainId === 42_161) {
    return <Image alt="Arbitrum" height={14} src="/assets/arbitrum.png" width={14} />;
  }
  return null;
}

export function NetworkFilter({
  chainIds,
  selectedChain,
  includeAllNetworks = true,
  hideArrow = false,
  onPressChain,
  className,
  chainLabels,
}: NetworkFilterProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const dedupedChains = useMemo(
    () => Array.from(new Set(chainIds.filter((chainId) => Number.isFinite(chainId)))),
    [chainIds]
  );

  const selectedLabel =
    selectedChain === null ? "All networks" : getChainLabel(selectedChain, chainLabels);

  useEffect(() => {
    if (!open) {
      return;
    }

    function onEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null;
      if (!target || containerRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }

    document.addEventListener("keydown", onEscape);
    document.addEventListener("pointerdown", onPointerDown);

    return () => {
      document.removeEventListener("keydown", onEscape);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open]);

  return (
    <div className={cn("relative", className)} ref={containerRef}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          "flex h-10 items-center gap-2 rounded-full border border-gray-200 bg-white px-3 font-semibold text-black text-sm shadow-sm",
          "transition hover:bg-numo-pill/50"
        )}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="flex items-center gap-2">
          {selectedChain !== null ? <NetworkIcon chainId={selectedChain} /> : null}
          <span>{selectedLabel}</span>
        </span>
        {hideArrow ? null : (
          <ChevronDown
            className={cn(
              "h-4 w-4 text-numo-muted transition-transform",
              open ? "rotate-180" : "rotate-0"
            )}
          />
        )}
      </button>

      {open ? (
        <div className="absolute left-0 z-10 mt-3 min-w-44 rounded-2xl border border-numo-border bg-white p-2 shadow-xl">
          {includeAllNetworks ? (
            <button
              className={cn(
                "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-numo-pill/60",
                selectedChain === null ? "bg-numo-pill" : "bg-transparent"
              )}
              onClick={() => {
                onPressChain(null);
                setOpen(false);
              }}
              role="menuitem"
              type="button"
            >
              <span>All networks</span>
              {selectedChain === null ? <Check className="h-4 w-4 text-black" /> : null}
            </button>
          ) : null}

          {dedupedChains.map((chainId) => {
            const isSelected = selectedChain === chainId;
            return (
              <button
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition hover:bg-numo-pill/60",
                  isSelected ? "bg-numo-pill" : "bg-transparent"
                )}
                key={chainId}
                onClick={() => {
                  onPressChain(chainId);
                  setOpen(false);
                }}
                role="menuitem"
                type="button"
              >
                <span className="flex items-center gap-2">
                  <NetworkIcon chainId={chainId} />
                  <span>{getChainLabel(chainId, chainLabels)}</span>
                </span>
                {isSelected ? <Check className="h-4 w-4 text-black" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
