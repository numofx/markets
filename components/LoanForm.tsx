"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Pencil, CalendarDays } from "lucide-react";
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

const lendAssetOptions: AssetOption[] = [
  {
    code: "KESm",
    name: "Kenyan Shilling",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
  },
];

const receiveAssetOptions: AssetOption[] = [
  {
    code: "fyKESm · May 4 2026",
    name: "fyKESm",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
  },
];

const PRICE_BASE_PER_FY = Number("0.21376880592600005");

function convertBaseToFy(baseAmount: number) {
  return PRICE_BASE_PER_FY > 0 ? baseAmount / PRICE_BASE_PER_FY : 0;
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 6 }) : "0";
}

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
    () => lendAssetOptions[0].code,
  );
  const [secondaryAsset, setSecondaryAsset] = useState<AssetOption["code"]>(
    () => receiveAssetOptions[0].code,
  );
  const [selectedTermId, setSelectedTermId] = useState(termOptions[0]?.id ?? "");
  const [isTermOpen, setIsTermOpen] = useState(false);

  const selectedTerm =
    termOptions.find((option) => option.id === selectedTermId) ?? termOptions[0];
  const amountValue = Number.parseFloat(amount);
  const receiveAmount =
    amount === "" || Number.isNaN(amountValue)
      ? "0"
      : formatNumber(convertBaseToFy(amountValue));
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
    <div className="rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-medium text-[11px] text-black/60">You pay</div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <input
          aria-label="Pay amount"
          className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none"
          inputMode="decimal"
          onChange={(event) => setAmount(event.target.value)}
          placeholder="0"
          type="text"
          value={amount}
        />
        <AssetSelect
          onChange={setPrimaryAsset}
          options={lendAssetOptions}
          value={primaryAsset}
          headerLabel="Select currency"
        />
      </div>
      <div className="mt-2 text-black/35 text-xs">KESm</div>
    </div>

    <div className="mt-3 rounded-3xl border border-black/5 bg-[#F6F6F2] p-5 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="font-medium text-[11px] text-black/60">You receive</div>
      <div className="mt-4 flex items-center justify-between gap-4">
        <div className="w-full bg-transparent font-medium text-3xl text-black/60 outline-none">
          {receiveAmount}
        </div>
        <AssetSelect
          onChange={setSecondaryAsset}
          options={receiveAssetOptions}
          value={secondaryAsset}
        />
      </div>
      <div className="mt-1 text-black/50 text-xs">
        Redeems 1:1 for KESm at maturity
      </div>
    </div>

    <div className="mt-5 rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-9 items-center gap-1 rounded-full border border-black/10 bg-[#F6F6F2] px-3 font-semibold text-black/80 text-sm">
            <CalendarDays className="h-3 w-3 text-black/50" />
            {selectedTerm?.dateLabel ?? "Select"}
          </span>
          <button
            className="flex h-8 w-8 items-center justify-center rounded-full border border-black/10 text-black/50"
            onClick={() => setIsTermOpen(true)}
            type="button"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <span className="text-black/60 text-sm">·</span>
          <span className="text-black/80 text-sm">
            {selectedTerm?.days === 1 ? "1 day" : `${selectedTerm?.days ?? 0} days`}
          </span>
        </div>
        <div className="flex flex-col items-end text-right">
          <span className="text-black/60 text-xs">You lock in</span>
          <span className="font-semibold text-lg text-neutral-900">5.80% APR</span>
        </div>
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
        Review Order → Buy fyKESm
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
