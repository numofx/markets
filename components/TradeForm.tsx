"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { AssetSelect } from "@/ui/AssetSelect";

type AssetOption = {
  code: string;
  name: string;
  flagSrc: string;
};

type TradeFormProps = {
  className?: string;
};

const lendAssetOptions: AssetOption[] = [
  {
    code: "KESm",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
    name: "Kenyan Shilling",
  },
];

const receiveAssetOptions: AssetOption[] = [
  {
    code: "fyKESm",
    flagSrc: "/assets/KESm (Mento Kenyan Shilling).svg",
    name: "fyKESm",
  },
];

const PRICE_BASE_PER_FY = Number("0.21376880592600005");
const MATURITY_TIMESTAMP = 1777903200n;
const BASE_BALANCE_WAD = 6_625_256_142_317_498_712n;
const FY_BALANCE_WAD = 30_992_623_613_245_757_308n;

function convertBaseToFy(baseAmount: number) {
  return PRICE_BASE_PER_FY > 0 ? baseAmount / PRICE_BASE_PER_FY : 0;
}

function formatNumber(value: number) {
  return Number.isFinite(value)
    ? value.toLocaleString(undefined, { maximumFractionDigits: 6 })
    : "0";
}

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function TradeForm({ className }: TradeFormProps) {
  const [amount, setAmount] = useState("");
  const [primaryAsset, setPrimaryAsset] = useState<AssetOption["code"]>(
    () => lendAssetOptions[0].code
  );
  const [secondaryAsset, setSecondaryAsset] = useState<AssetOption["code"]>(
    () => receiveAssetOptions[0].code
  );
  const amountValue = Number.parseFloat(amount);
  const receiveAmount =
    amount === "" || Number.isNaN(amountValue) ? "0" : formatNumber(convertBaseToFy(amountValue));
  const canReview = Number.isFinite(amountValue) && amountValue > 0 && Boolean(primaryAsset);

  const [aprText, setAprText] = useState("—");

  useEffect(() => {
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = MATURITY_TIMESTAMP - nowSeconds;
    if (timeRemaining <= 0n) {
      setAprText("—");
      return;
    }
    const priceWad = (BASE_BALANCE_WAD * WAD) / FY_BALANCE_WAD;
    const apr = aprFromPriceWad(priceWad, timeRemaining);
    setAprText(formatAprPercent(apr));
  }, []);

  return (
    <div
      className={cn(
        "w-full max-w-md rounded-[32px] border border-black/5 bg-[#FAFAF8] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.08)]",
        className
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
            headerLabel="Select currency"
            onChange={setPrimaryAsset}
            options={lendAssetOptions}
            value={primaryAsset}
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
        <div className="mt-1 text-black/50 text-xs">Redeems 1:1 for KESm at maturity</div>
      </div>

      <div className="mt-5 rounded-2xl border border-black/10 bg-white px-4 py-3 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <div className="text-black/60 text-sm">You lock in</div>
          <div className="font-semibold text-lg text-neutral-900">{aprText}</div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2">
        <button
          className={cn(
            "h-12 flex-1 rounded-2xl px-4 font-semibold text-sm text-white shadow-[0_10px_30px_rgba(0,0,0,0.10)] transition-colors",
            canReview
              ? "bg-black/80 hover:bg-black/90"
              : "cursor-not-allowed bg-black/10 text-black/30 shadow-none"
          )}
          disabled={!canReview}
          type="button"
        >
          Review Order → Buy fyKESm
        </button>
      </div>

      <div className="mt-3 text-center text-black/50 text-xs">
        Pool{" "}
        <a
          className="text-black/80 underline-offset-2 hover:text-black"
          href={CELO_YIELD_POOL.explorerUrl}
          rel="noreferrer"
          target="_blank"
        >
          {shortAddress(CELO_YIELD_POOL.poolAddress)}
        </a>{" "}
        on Celoscan
      </div>

      <p className="mt-4 text-center text-black/50 text-xs">
        By executing a transaction, you accept the User Agreement.
      </p>
    </div>
  );
}
