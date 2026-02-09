"use client";

import { Check, ChevronDown } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

type AssetOption = {
  code: string;
  name: string;
  flagSrc: string;
};

type AssetSelectProps = {
  options: AssetOption[];
  value?: AssetOption["code"];
  onChange?: (value: AssetOption["code"]) => void;
  className?: string;
  headerLabel?: string;
};

export function AssetSelect({
  options,
  value,
  onChange,
  className,
  headerLabel,
}: AssetSelectProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<AssetOption["code"]>(value ?? options[0].code);

  useEffect(() => {
    if (value !== undefined) {
      setSelected(value);
    }
  }, [value]);

  const active = options.find((option) => option.code === selected) ?? options[0];

  return (
    <div className={cn("relative", className)}>
      <button
        className="flex min-w-[180px] items-center justify-between gap-2 rounded-full border border-border bg-white px-3 py-1.5 font-semibold text-numo-ink/90 text-xs shadow-none"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="flex h-6 w-6 items-center justify-center overflow-hidden rounded-full bg-numo-accent/10">
          <Image
            alt={active.code}
            className="h-full w-full object-cover"
            height={18}
            src={active.flagSrc}
            width={18}
          />
        </span>
        <span>{active.code}</span>
        <ChevronDown
          className={cn("h-4 w-4 text-numo-muted transition", open ? "rotate-180" : "")}
        />
      </button>

      {open ? (
        <div className="absolute left-0 z-10 mt-2 w-72 rounded-2xl border border-numo-border bg-white p-2 shadow-lg">
          <div className="px-3 py-2 font-semibold text-numo-muted text-xs uppercase tracking-wide">
            {headerLabel ?? "Select bond"}
          </div>
          <div className="flex flex-col">
            {options.map((option) => (
              <button
                className={cn(
                  "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm transition",
                  option.code === active.code
                    ? "bg-numo-pill font-semibold text-numo-ink"
                    : "text-numo-ink hover:bg-numo-pill"
                )}
                key={option.code}
                onClick={() => {
                  setSelected(option.code);
                  onChange?.(option.code);
                  setOpen(false);
                }}
                type="button"
              >
                <span className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-numo-accent/10">
                    <Image
                      alt={option.code}
                      className="h-full w-full object-cover"
                      height={20}
                      src={option.flagSrc}
                      width={20}
                    />
                  </span>
                  <span>
                    <span className="font-semibold">{option.code}</span>
                    <span className="block text-numo-muted text-xs">{option.name}</span>
                  </span>
                </span>
                {option.code === active.code ? (
                  <Check className="h-4 w-4 text-numo-accent" />
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
