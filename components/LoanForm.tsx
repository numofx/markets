"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { AssetSelect } from "@/ui/AssetSelect";
import type { TermOption } from "@/ui/SelectTermSheet";
import { SelectTermSheet } from "@/ui/SelectTermSheet";

type AssetOption = {
  code: string;
  name: string;
  flagSrc: string;
};

type LoanFormProps = {
  className?: string;
};

const assetOptions: AssetOption[] = [
  { code: "USD", name: "US Dollar", flagSrc: "/flags/us.svg" },
  { code: "KES", name: "Kenyan Shilling", flagSrc: "/flags/ke.svg" },
];

export function LoanForm({ className }: LoanFormProps) {
  const termOptions = useMemo<TermOption[]>(
    () => [
      { id: "2026-01-16", dateLabel: "Jan 16", days: 1, apr: 6.0, bestRate: true },
      { id: "2026-01-22", dateLabel: "Jan 22", days: 7, apr: 5.9, bestRate: false },
    ],
    [],
  );
  const [amount, setAmount] = useState("");
  const [primaryAsset, setPrimaryAsset] = useState<AssetOption["code"]>(
    () => assetOptions.find((option) => option.code === "USDC")?.code ?? assetOptions[0].code,
  );
  const [secondaryAsset, setSecondaryAsset] = useState<AssetOption["code"]>(
    assetOptions[1]?.code ?? assetOptions[0].code,
  );
  const [selectedTermId, setSelectedTermId] = useState(termOptions[0]?.id ?? "");
  const [isTermOpen, setIsTermOpen] = useState(false);

  const selectedTerm =
    termOptions.find((option) => option.id === selectedTermId) ?? termOptions[0];
  const daysLabel = selectedTerm?.days === 1 ? "1 day" : `${selectedTerm?.days ?? 0} days`;

  const exposureLabel = "Receive";

  const amountValue = Number.parseFloat(amount);
  const receiveAmount = amount === "" ? "0" : amount;
  const canReview =
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    Boolean(primaryAsset) &&
    Boolean(selectedTermId);

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-[32px] border border-black/5 bg-[#FAFAF8] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)]",
        className,
      )}
    >
      <div className="mb-4 flex items-center">
        <button
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-black/10 bg-black/5 text-black/50 shadow-none"
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      </div>

      <div className="rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="font-medium text-[11px] text-black/60">
          Lend
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <input
            aria-label="Lend amount"
            className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none"
            inputMode="decimal"
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0"
            type="text"
            value={amount}
          />
          <AssetSelect
            onChange={setPrimaryAsset}
            options={assetOptions}
            value={primaryAsset}
          />
        </div>
        <div className="mt-2 text-black/35 text-xs">$0.00</div>
      </div>

      <div className="mt-3 rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="font-medium text-[11px] text-black/60">
          {exposureLabel}
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none">
            {receiveAmount}
          </div>
          <AssetSelect
            onChange={setSecondaryAsset}
            options={assetOptions}
            value={secondaryAsset}
          />
        </div>
        <div className="mt-2 text-black/35 text-xs">$0.00</div>
      </div>

      <div className="mt-6 rounded-2xl bg-[#fafaf8] px-6 py-4">
        <div className="grid gap-y-0.5">
          <div className="text-neutral-500 text-sm leading-none">Yield</div>
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 rounded-full border px-3 py-1 text-sm leading-none"
              onClick={() => setIsTermOpen(true)}
              type="button"
            >
              {selectedTerm?.dateLabel ?? "Select"}
              <Pencil size={14} className="opacity-60" />
            </button>
            <div className="min-w-0 text-center font-semibold text-5xl text-neutral-900 leading-none tracking-tight">
              {selectedTerm?.apr.toFixed(2) ?? "0.00"}%
            </div>
            <div className="rounded-full border px-3 py-1 text-neutral-600 text-sm leading-none">
              Fixed APR
            </div>
          </div>
          <div className="text-neutral-500 text-xs leading-none">{daysLabel} term</div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          className={cn(
            "h-12 flex-1 rounded-2xl px-4 font-semibold text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,0.10)] transition-colors",
            canReview
              ? "bg-black/80 hover:bg-black/90"
              : "cursor-not-allowed bg-black/10 text-black/30 shadow-none",
          )}
          disabled={!canReview}
          type="button"
        >
          Review Order
        </button>
      </div>

      <p className="mt-4 text-center text-black/50 text-xs">
        By executing a transaction, you accept the User Agreement.
      </p>
      <SelectTermSheet
        onClose={() => setIsTermOpen(false)}
        onSelect={setSelectedTermId}
        open={isTermOpen}
        options={termOptions}
        selectedId={selectedTermId}
      />
    </div>
  );
}
