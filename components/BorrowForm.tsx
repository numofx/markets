"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  borrowFyKes,
  createVault,
  depositUsdt,
  repayFyKes,
  withdrawUsdt,
} from "@/src/borrow-actions";
import { BORROW_CONFIG } from "@/src/borrow-config";

type BorrowFormProps = {
  className?: string;
};

type ActionName = "create" | "deposit" | "borrow" | "repay" | "withdraw" | null;

export function BorrowForm({ className }: BorrowFormProps) {
  const [vaultId, setVaultId] = useState<string | null>(null);
  const [usdtDeposit, setUsdtDeposit] = useState("");
  const [borrowAmount, setBorrowAmount] = useState("");
  const [repayAmount, setRepayAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [pendingAction, setPendingAction] = useState<ActionName>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [steps, setSteps] = useState<string[]>([]);

  async function runAction(
    action: ActionName,
    handler: () => Promise<{ status: string; steps: string[] }>
  ) {
    setPendingAction(action);
    setStatus(null);
    setSteps([]);
    try {
      const nextResult = await handler();
      setStatus(nextResult.status);
      setSteps(nextResult.steps);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setStatus(`Error: ${message}`);
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div
      className={cn(
        "w-full rounded-3xl border border-numo-border bg-white/80 p-6 shadow-lg backdrop-blur",
        className
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-numo-ink text-xl">Borrow fyKESm</h2>
          <p className="text-numo-muted text-sm">
            Create a vault, post USDT collateral, and borrow fyKESm.
          </p>
        </div>
        <div className="rounded-full border border-numo-border bg-numo-pill px-3 py-1 text-numo-muted text-xs">
          {vaultId ? `Vault: ${vaultId}` : "No vault yet"}
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-numo-border bg-white px-4 py-3 text-numo-muted text-xs">
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          <span>SeriesId: {BORROW_CONFIG.seriesId.fyKesm}</span>
          <span>BaseId (KESm): {BORROW_CONFIG.baseIds.kesm}</span>
          <span>Ilk (USDT): {BORROW_CONFIG.ilk.usdt}</span>
          <span>USDT: {BORROW_CONFIG.tokens.usdt}</span>
          <span>USDT Join: {BORROW_CONFIG.joins.usdt}</span>
          <span>FYKESm: {BORROW_CONFIG.tokens.fyKesm}</span>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-numo-ink text-sm">1. Create Vault</h3>
          <p className="mt-1 text-numo-muted text-xs">
            Initializes a fresh vault for your USDT collateral.
          </p>
          <button
            className="mt-3 w-full rounded-xl bg-numo-ink px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={pendingAction !== null}
            onClick={() =>
              runAction("create", async () => {
                const result = await createVault();
                setVaultId(result.vaultId);
                return {
                  status: `Tx 1 — Vault created • ${result.txHash}`,
                  steps: result.steps,
                };
              })
            }
            type="button"
          >
            {pendingAction === "create" ? "Creating..." : "Create Vault"}
          </button>
        </div>

        <div className="rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-numo-ink text-sm">2. Deposit USDT</h3>
          <p className="mt-1 text-numo-muted text-xs">
            Add collateral to your vault before borrowing.
          </p>
          <input
            className="mt-3 w-full rounded-xl border border-numo-border px-3 py-2 text-sm focus:border-numo-ink focus:outline-none"
            onChange={(event) => setUsdtDeposit(event.target.value)}
            placeholder="USDT amount"
            type="number"
            value={usdtDeposit}
          />
          <button
            className="mt-3 w-full rounded-xl bg-numo-ink px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={!vaultId || pendingAction !== null || usdtDeposit.length === 0}
            onClick={() =>
              runAction("deposit", async () => {
                const result = await depositUsdt(usdtDeposit);
                return {
                  status: `Tx 2 — Deposited USDT • ${result.txHash}`,
                  steps: result.steps,
                };
              })
            }
            type="button"
          >
            {pendingAction === "deposit" ? "Depositing..." : "Deposit USDT"}
          </button>
        </div>

        <div className="rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-numo-ink text-sm">3. Borrow fyKESm</h3>
          <p className="mt-1 text-numo-muted text-xs">Borrow against your deposited collateral.</p>
          <input
            className="mt-3 w-full rounded-xl border border-numo-border px-3 py-2 text-sm focus:border-numo-ink focus:outline-none"
            onChange={(event) => setBorrowAmount(event.target.value)}
            placeholder="fyKESm amount"
            type="number"
            value={borrowAmount}
          />
          <button
            className="mt-3 w-full rounded-xl bg-numo-ink px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={!vaultId || pendingAction !== null || borrowAmount.length === 0}
            onClick={() =>
              runAction("borrow", async () => {
                const result = await borrowFyKes(borrowAmount);
                return {
                  status: `Tx 3 — Borrowed fyKESm • ${result.txHash}`,
                  steps: result.steps,
                };
              })
            }
            type="button"
          >
            {pendingAction === "borrow" ? "Borrowing..." : "Borrow fyKESm"}
          </button>
        </div>

        <div className="rounded-2xl border border-numo-border bg-white p-4 shadow-sm">
          <h3 className="font-semibold text-numo-ink text-sm">4. Repay</h3>
          <p className="mt-1 text-numo-muted text-xs">
            Repay borrowed fyKESm to unlock collateral.
          </p>
          <input
            className="mt-3 w-full rounded-xl border border-numo-border px-3 py-2 text-sm focus:border-numo-ink focus:outline-none"
            onChange={(event) => setRepayAmount(event.target.value)}
            placeholder="fyKESm amount"
            type="number"
            value={repayAmount}
          />
          <button
            className="mt-3 w-full rounded-xl bg-numo-ink px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={!vaultId || pendingAction !== null || repayAmount.length === 0}
            onClick={() =>
              runAction("repay", async () => {
                const result = await repayFyKes(repayAmount);
                return {
                  status: `Tx 4 — Repaid fyKESm • ${result.txHash}`,
                  steps: result.steps,
                };
              })
            }
            type="button"
          >
            {pendingAction === "repay" ? "Repaying..." : "Repay fyKESm"}
          </button>
        </div>

        <div className="rounded-2xl border border-numo-border bg-white p-4 shadow-sm md:col-span-2">
          <h3 className="font-semibold text-numo-ink text-sm">5. Withdraw USDT</h3>
          <p className="mt-1 text-numo-muted text-xs">
            Withdraw remaining collateral after repayment.
          </p>
          <div className="mt-3 flex flex-col gap-3 md:flex-row">
            <input
              className="w-full rounded-xl border border-numo-border px-3 py-2 text-sm focus:border-numo-ink focus:outline-none"
              onChange={(event) => setWithdrawAmount(event.target.value)}
              placeholder="USDT amount"
              type="number"
              value={withdrawAmount}
            />
            <button
              className="w-full rounded-xl bg-numo-ink px-4 py-2 font-semibold text-sm text-white transition hover:opacity-90 disabled:opacity-50 md:w-auto md:min-w-[180px]"
              disabled={!vaultId || pendingAction !== null || withdrawAmount.length === 0}
              onClick={() =>
                runAction("withdraw", async () => {
                  const result = await withdrawUsdt(withdrawAmount);
                  return {
                    status: `Tx 5 — Withdrew USDT • ${result.txHash}`,
                    steps: result.steps,
                  };
                })
              }
              type="button"
            >
              {pendingAction === "withdraw" ? "Withdrawing..." : "Withdraw USDT"}
            </button>
          </div>
        </div>
      </div>

      {status ? (
        <div className="mt-4 rounded-2xl border border-numo-border bg-numo-pill px-4 py-3 text-numo-ink text-xs">
          <div>{status}</div>
          {steps.length > 0 ? (
            <div className="mt-2 space-y-1 text-[11px] text-numo-muted">
              <div>USDT has 6 decimals: 10 USDT = 10,000,000.</div>
              {steps.map((step) => (
                <div key={step}>• {step}</div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
