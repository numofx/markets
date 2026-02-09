"use client";

import type { Hex } from "viem";
import { cn } from "@/lib/cn";
import { BORROW_CONFIG } from "@/src/borrow-config";

function DiagnosticsBlock({
  diagnostics,
}: {
  diagnostics: NonNullable<BorrowFormViewProps["diagnostics"]>;
}) {
  return (
    <>
      <div>RPC: {diagnostics.rpcUrl}</div>
      <div>App chainId: {diagnostics.appChainId ?? "—"}</div>
      <div>User: {diagnostics.userAddress ?? "—"}</div>
      <div>USDT (queried): {diagnostics.usdtToken}</div>
      {diagnostics.usdtDecimals !== undefined ? (
        <div>USDT decimals: {diagnostics.usdtDecimals}</div>
      ) : null}
      {diagnostics.usdtBalance !== undefined ? (
        <div>USDT balance: {diagnostics.usdtBalance}</div>
      ) : null}
      {diagnostics.usdtBalanceRaw !== undefined ? (
        <div>USDT balance raw: {diagnostics.usdtBalanceRaw}</div>
      ) : null}
      {diagnostics.lastError ? (
        <div className="text-red-700">Read error: {diagnostics.lastError}</div>
      ) : null}
    </>
  );
}

type BorrowFormViewProps = {
  className?: string;
  vaultReady: boolean;
  collateralBalanceLabel: string;
  collateralInput: string;
  collateralUsdLabel: string;
  maxCollateralDisabled: boolean;
  onCollateralChange: (value: string) => void;
  onMaxCollateral: () => void;
  borrowInput: string;
  borrowValueLabel: string;
  borrowBalanceLabel: string;
  borrowTokenSymbol: string;
  onBorrowChange: (value: string) => void;
  ltvLabel: string;
  submitDisabled: boolean;
  submitLabel: string;
  onSubmit: () => void;
  txHash: Hex | null;
  txStatus: string | null;
  diagnostics?: {
    appChainId: number | null;
    rpcUrl: string;
    userAddress?: string;
    usdtToken: string;
    usdtDecimals?: number;
    usdtBalance?: string;
    usdtBalanceRaw?: string;
    lastError?: string | null;
  };
};

export function BorrowFormView(props: BorrowFormViewProps) {
  return (
    <div className={cn("w-full", props.className)}>
      <div className="mx-auto flex w-full max-w-md flex-col gap-4">
        <div className="rounded-3xl border border-numo-border bg-white/80 p-5 shadow-lg backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-numo-ink text-xl">Borrow</h2>
              <p className="mt-1 text-numo-muted text-sm">
                Supply USDT collateral and borrow KESm at the current pool price.
              </p>
            </div>
            <div className="rounded-full border border-numo-border bg-numo-pill px-3 py-1 text-numo-muted text-xs">
              {props.vaultReady ? "Vault ready" : "No vault"}
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-numo-border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-numo-muted text-sm">Supply Collateral (USDT)</div>
              <div className="mt-2 text-5xl text-numo-ink">
                <input
                  className="w-full bg-transparent outline-none"
                  inputMode="decimal"
                  onChange={(event) => props.onCollateralChange(event.target.value)}
                  placeholder="0"
                  value={props.collateralInput}
                />
              </div>
              <div className="mt-3 text-numo-muted text-sm">$ {props.collateralUsdLabel}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-1 text-numo-ink text-sm shadow-sm">
                <span className="font-semibold">USDT</span>
              </div>
              <div className="text-numo-muted text-xs">{props.collateralBalanceLabel}</div>
              <button
                className="rounded-full bg-numo-pill px-4 py-2 text-numo-ink text-xs transition hover:opacity-90 disabled:opacity-50"
                disabled={props.maxCollateralDisabled}
                onClick={props.onMaxCollateral}
                type="button"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-numo-border bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="text-numo-muted text-sm">Borrow ({props.borrowTokenSymbol})</div>
              <div className="mt-2 text-5xl text-numo-ink">
                <input
                  className="w-full bg-transparent outline-none"
                  inputMode="decimal"
                  onChange={(event) => props.onBorrowChange(event.target.value)}
                  placeholder="0"
                  value={props.borrowInput}
                />
              </div>
              <div className="mt-3 text-numo-muted text-sm">{props.borrowValueLabel}</div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-1 text-numo-ink text-sm shadow-sm">
                <span className="font-semibold">{props.borrowTokenSymbol}</span>
              </div>
              <div className="text-numo-muted text-xs">{props.borrowBalanceLabel}</div>
              <button
                className="rounded-full bg-numo-pill px-4 py-2 text-numo-ink text-xs opacity-50"
                disabled
                type="button"
              >
                MAX
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-numo-border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between text-numo-ink">
            <div className="text-sm">Collateral (USDT)</div>
            <div className="text-sm">{props.collateralInput || "0"}</div>
          </div>
          <div className="mt-3 flex items-center justify-between text-numo-ink">
            <div className="text-sm">Loan ({props.borrowTokenSymbol})</div>
            <div className="text-sm">{props.borrowInput || "0"}</div>
          </div>
          <div className="mt-3 flex items-center justify-between text-numo-ink">
            <div className="text-sm">LTV (est.)</div>
            <div className="text-sm">{props.ltvLabel}</div>
          </div>
          <div className="mt-3 flex items-center justify-between text-numo-ink">
            <div className="text-sm">Liquidation LTV</div>
            <div className="text-sm">86%</div>
          </div>
          <div className="mt-3 flex items-center justify-between text-numo-ink">
            <div className="text-sm">Rate</div>
            <div className="text-sm">—</div>
          </div>
        </div>

        <button
          className="h-12 w-full rounded-2xl bg-numo-ink font-semibold text-sm text-white transition hover:opacity-90 disabled:bg-numo-pill disabled:text-numo-muted disabled:opacity-100"
          disabled={props.submitDisabled}
          onClick={props.onSubmit}
          type="button"
        >
          {props.submitLabel}
        </button>

        {props.txStatus || props.txHash ? (
          <div className="rounded-3xl border border-numo-border bg-white/80 p-5 text-numo-ink text-sm shadow-sm backdrop-blur">
            <div className="font-semibold">{props.txStatus ?? "Transaction submitted."}</div>
            {props.txHash ? (
              <div className="mt-2 break-all text-numo-muted text-xs">{props.txHash}</div>
            ) : null}
          </div>
        ) : null}

        <details className="rounded-3xl border border-numo-border bg-white/50 p-5 text-numo-muted text-xs shadow-sm">
          <summary className="cursor-pointer select-none text-numo-ink">Advanced</summary>
          <div className="mt-3 grid gap-1">
            {props.diagnostics ? <DiagnosticsBlock diagnostics={props.diagnostics} /> : null}
            <div>SeriesId: {BORROW_CONFIG.seriesId.fyKesm}</div>
            <div>Ilk (USDT): {BORROW_CONFIG.ilk.usdt}</div>
            <div>Ladle: {BORROW_CONFIG.core.ladle}</div>
            <div>USDT: {BORROW_CONFIG.tokens.usdt}</div>
            <div>USDT Join: {BORROW_CONFIG.joins.usdt}</div>
            <div>fyKESm: {BORROW_CONFIG.tokens.fyKesm}</div>
          </div>
        </details>
      </div>
    </div>
  );
}
