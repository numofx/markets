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

  async function runAction(action: ActionName, handler: () => Promise<string>) {
    setPendingAction(action);
    setStatus(null);
    try {
      const nextStatus = await handler();
      setStatus(nextStatus);
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
                return `Vault created • ${result.txHash}`;
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
                return `Deposited USDT • ${result.txHash}`;
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
                return `Borrowed fyKESm • ${result.txHash}`;
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
                return `Repaid fyKESm • ${result.txHash}`;
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
                  return `Withdrew USDT • ${result.txHash}`;
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
          {status}
        </div>
      ) : null}
    </div>
  );
}
