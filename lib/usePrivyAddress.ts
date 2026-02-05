"use client";

import { useWallets } from "@privy-io/react-auth";
import type { Address } from "viem";

export function usePrivyAddress(): Address | undefined {
  const { wallets } = useWallets();
  const connectedWallet =
    wallets.find((item) => item.type === "ethereum" && item.isConnected) ??
    wallets.find((item) => item.type === "ethereum");
  const wallet = connectedWallet;
  return wallet?.address as Address | undefined;
}
