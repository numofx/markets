"use client";

import { ChevronDown, Wallet } from "lucide-react";
import { usePrivy } from "@privy-io/react-auth";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";

export function PrivyConnectPill() {
  const { ready, authenticated, login } = usePrivy();
  const { wallet } = usePrivyWalletClient();

  if (!ready) {
    return null;
  }

  const addr = authenticated ? wallet?.address ?? null : null;
  const label = addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "Connect wallet";

  return (
    <button
      onClick={() => {
        if (!authenticated) {
          login();
        }
      }}
      className="flex items-center gap-2 rounded-full border border-numo-border bg-white px-3 py-2 font-semibold text-numo-ink text-xs shadow-sm"
      type="button"
    >
      <Wallet className="h-4 w-4 text-numo-muted" />
      <span>{label}</span>
      <ChevronDown className="h-3 w-3 text-numo-muted" />
    </button>
  );
}
