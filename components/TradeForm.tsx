"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import { aprFromPriceWad, formatAprPercent, WAD } from "@/src/apr";
import { CELO_YIELD_POOL } from "@/src/poolInfo";
import { AssetSelect } from "@/ui/AssetSelect";
import { usePoolReads } from "@/lib/usePoolReads";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { publicClient } from "@/lib/celoClients";
import { poolAbi } from "@/lib/abi/pool";
import { formatUnits, parseUnits, type Address } from "viem";

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
  const [quote, setQuote] = useState<string>("0");
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const userAddress: Address | undefined = usePrivyAddress();
  const {
    loading,
    error,
    poolBaseBalance,
    poolFyBalance,
    maturity,
    baseDecimals,
    fyDecimals,
    baseSymbol,
    fySymbol,
    userBaseBal,
    userFyBal,
  } = usePoolReads(userAddress);
  const [primaryAsset, setPrimaryAsset] = useState<AssetOption["code"]>(
    () => lendAssetOptions[0].code
  );
  const [secondaryAsset, setSecondaryAsset] = useState<AssetOption["code"]>(
    () => receiveAssetOptions[0].code
  );
  const receiveAmount = quote;

  const [aprText, setAprText] = useState("—");

  useEffect(() => {
    if (maturity == null || poolBaseBalance == null || poolFyBalance == null) {
      setAprText("—");
      return;
    }
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    const timeRemaining = BigInt(maturity) - nowSeconds;
    if (timeRemaining <= 0n) {
      setAprText("—");
      return;
    }
    const priceWad = (poolBaseBalance * WAD) / poolFyBalance;
    const apr = aprFromPriceWad(priceWad, timeRemaining);
    setAprText(formatAprPercent(apr));
  }, [maturity, poolBaseBalance, poolFyBalance]);

  useEffect(() => {
    if (baseDecimals == null || fyDecimals == null || amount === "") {
      setQuote("0");
      setQuoteError(null);
      return;
    }

    let cancelled = false;
    setQuoteLoading(true);

    const timeout = setTimeout(() => {
      const fetchQuote = async () => {
        try {
          const baseAmount = parseUnits(amount, baseDecimals);
          const maxUint128 = (1n << 128n) - 1n;
          if (baseAmount > maxUint128) {
            throw new Error("Amount too large for pool preview.");
          }
          const fyOut = await publicClient.readContract({
            address: CELO_YIELD_POOL.poolAddress as Address,
            abi: poolAbi,
            functionName: "sellBasePreview",
            args: [baseAmount],
          });
          if (cancelled) {
            return;
          }
          setQuote(formatNumber(Number.parseFloat(formatUnits(fyOut, fyDecimals))));
          setQuoteError(null);
        } catch (caught) {
          if (cancelled) {
            return;
          }
          setQuote("0");
          setQuoteError(caught instanceof Error ? caught.message : "Failed to quote");
        } finally {
          if (!cancelled) {
            setQuoteLoading(false);
          }
        }
      };

      void fetchQuote();
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [amount, baseDecimals, fyDecimals]);

  const maturityLabel = maturity != null ? new Date(maturity * 1000).toLocaleString() : "—";
  const poolBaseLabel =
    poolBaseBalance != null && baseDecimals != null && baseSymbol
      ? `${formatUnits(poolBaseBalance, baseDecimals)} ${baseSymbol}`
      : "—";
  const poolFyLabel =
    poolFyBalance != null && fyDecimals != null && fySymbol
      ? `${formatUnits(poolFyBalance, fyDecimals)} ${fySymbol}`
      : "—";
  const userBaseLabel =
    userBaseBal != null && baseDecimals != null && baseSymbol
      ? `${formatUnits(userBaseBal, baseDecimals)} ${baseSymbol}`
      : null;
  const userFyLabel =
    userFyBal != null && fyDecimals != null && fySymbol
      ? `${formatUnits(userFyBal, fyDecimals)} ${fySymbol}`
      : null;

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

      <div className="mt-4 rounded-2xl border border-black/10 bg-white px-4 py-3 text-xs text-black/60 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="flex items-center justify-between">
          <span>Maturity</span>
          <span className="text-black/80">{maturityLabel}</span>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span>Pool balances</span>
          <span className="text-black/80">
            {poolBaseLabel} · {poolFyLabel}
          </span>
        </div>
        {userBaseLabel && userFyLabel ? (
          <div className="mt-2 flex items-center justify-between">
            <span>Your balances</span>
            <span className="text-black/80">
              {userBaseLabel} · {userFyLabel}
            </span>
          </div>
        ) : null}
        {loading ? <div className="mt-2 text-black/40">Loading onchain data…</div> : null}
        {error ? <div className="mt-2 text-red-500">{error.message}</div> : null}
        {quoteLoading ? <div className="mt-2 text-black/40">Updating quote…</div> : null}
        {quoteError ? <div className="mt-2 text-red-500">{quoteError}</div> : null}
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
            "cursor-not-allowed bg-black/10 text-black/30 shadow-none"
          )}
          disabled
          type="button"
        >
          Read-only (coming next)
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
