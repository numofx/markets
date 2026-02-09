"use client";

import { useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";
import { useSoftWalletDisconnect } from "@/lib/useSoftWalletDisconnect";

export function usePrivyAddress(): Address | undefined {
  const { wallets } = useWallets();
  const { softDisconnected } = useSoftWalletDisconnect();
  if (softDisconnected) {
    return undefined;
  }
  const wallet = wallets.find((item) => item.type === "ethereum" && item.isConnected) ?? null;
  return wallet?.address as Address | undefined;
}
