"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, Pencil } from "lucide-react";
import { cn } from "@/lib/cn";
import { AssetSelect } from "@/ui/AssetSelect";
import { SelectTermSheet, type TermOption } from "@/ui/SelectTermSheet";

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
  const [primaryAsset, setPrimaryAsset] = useState<AssetOption["code"]>(() => {
    return assetOptions.find((option) => option.code === "USDC")?.code ?? assetOptions[0].code;
  });
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
  const canReview =
    Number.isFinite(amountValue) &&
    amountValue > 0 &&
    Boolean(primaryAsset) &&
    Boolean(selectedTermId);

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-3xl border border-numo-border bg-numo-card p-6 shadow-sm",
        className,
      )}
    >
      <div className="mt-6 rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
        <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">
          Lend
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <input
            aria-label="Lend amount"
            className="w-full bg-transparent font-semibold text-4xl text-numo-ink outline-none"
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
        <div className="mt-2 text-numo-muted text-xs">$0.00</div>
      </div>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
        <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">
          {exposureLabel}
        </div>
        <AssetSelect
          onChange={setSecondaryAsset}
          options={assetOptions}
          value={secondaryAsset}
        />
      </div>

      <div className="mt-5 rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="font-semibold text-numo-muted text-xs uppercase tracking-wide">
            Yield
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between gap-4">
          <div>
            <button
              className="flex items-center gap-2 rounded-2xl border border-numo-border bg-numo-pill px-3 py-2 text-numo-ink text-sm shadow-sm"
              onClick={() => setIsTermOpen(true)}
              type="button"
            >
              <span className="font-semibold">{selectedTerm?.dateLabel ?? "Select"}</span>
              <Pencil className="h-4 w-4 text-numo-muted" />
            </button>
            <div className="mt-2 text-numo-muted text-xs">{daysLabel} term</div>
          </div>
          <div className="flex items-center gap-3">
            <div className="font-bold text-3xl text-emerald-600 leading-none">
              {selectedTerm?.apr.toFixed(2) ?? "0.00"}%
            </div>
            <span className="rounded-full bg-numo-ink px-3 py-1 font-semibold text-white text-xs">
              Fixed APR
            </span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex items-center gap-2">
        <button
          aria-label="Back"
          className="flex h-10 w-10 items-center justify-center rounded-full border border-numo-border bg-white text-numo-muted shadow-sm"
          type="button"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          className={cn(
            "flex-1 rounded-full px-4 py-3 font-semibold text-sm shadow-sm transition",
            canReview
              ? "bg-numo-ink text-white"
              : "cursor-not-allowed bg-numo-pill text-numo-muted",
          )}
          disabled={!canReview}
          type="button"
        >
          Review Order
        </button>
      </div>

      <p className="mt-4 text-center text-numo-muted text-xs">
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
