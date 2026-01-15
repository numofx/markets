"use client";

import { useEffect, useMemo, useRef } from "react";
import { X, Zap } from "lucide-react";
import { cn } from "@/lib/cn";

export type TermOption = {
  id: string;
  dateLabel: string;
  days: number;
  apr: number;
  bestRate: boolean;
};

type SelectTermSheetProps = {
  open: boolean;
  options: TermOption[];
  selectedId: string;
  onSelect: (id: string) => void;
  onClose: () => void;
};

function getFocusableElements(container: HTMLElement | null) {
  if (!container) {
    return [];
  }

  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("disabled"));
}

export function SelectTermSheet({
  open,
  options,
  selectedId,
  onSelect,
  onClose,
}: SelectTermSheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const activeOption = useMemo(() => {
    return options.find((option) => option.id === selectedId) ?? options[0];
  }, [options, selectedId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusables = getFocusableElements(panelRef.current);
    focusables[0]?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const elements = getFocusableElements(panelRef.current);
      if (elements.length === 0) {
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const isShift = event.shiftKey;

      if (isShift && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!isShift && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      previousActive?.focus();
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="Close"
        className="absolute inset-0 bg-black/20"
        onClick={onClose}
        type="button"
      />
      <div
        aria-modal="true"
        className="absolute inset-x-0 bottom-0 mx-auto w-full max-w-2xl rounded-t-3xl border border-numo-border bg-numo-card p-6 shadow-xl sm:inset-auto sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        ref={panelRef}
        role="dialog"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-lg text-numo-ink">Select Term</h2>
          <button
            aria-label="Close"
            className="flex h-9 w-9 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3" role="radiogroup">
          {options.map((option) => {
            const isSelected = option.id === activeOption?.id;
            const daysLabel = option.days === 1 ? "1 day" : `${option.days} days`;
            return (
              <button
                aria-checked={isSelected}
                className={cn(
                  "flex items-center justify-between rounded-2xl border border-numo-border bg-white px-4 py-3 text-left shadow-sm transition",
                  isSelected ? "bg-numo-pill" : "hover:bg-numo-pill/60",
                )}
                key={option.id}
                onClick={() => {
                  onSelect(option.id);
                  onClose();
                }}
                role="radio"
                type="button"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border",
                      isSelected
                        ? "border-numo-ink bg-numo-ink"
                        : "border-numo-border bg-white",
                    )}
                  >
                    {isSelected ? (
                      <span className="h-2 w-2 rounded-full bg-white" />
                    ) : null}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-numo-ink">{option.dateLabel}</span>
                    <span className="rounded-full bg-numo-pill px-2 py-1 text-numo-muted text-xs">
                      {daysLabel}
                    </span>
                    {option.bestRate ? (
                      <span className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 font-semibold text-orange-700 text-xs">
                        <Zap className="h-3 w-3" />
                        Best rate
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="font-semibold text-numo-ink text-sm">
                  {option.apr.toFixed(2)}%
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
