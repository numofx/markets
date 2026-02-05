"use client";

import { useEffect, useState } from "react";
import type { ConnectedWallet, EIP1193Provider } from "@privy-io/react-auth";
import { useWallets } from "@privy-io/react-auth";
import type { Chain, WalletClient } from "viem";
import { createWalletClient, custom } from "viem";
import { celo } from "viem/chains";

type UsePrivyWalletClientResult = {
  ready: boolean;
  wallet: ConnectedWallet | null;
  provider: EIP1193Provider | null;
  walletClient: WalletClient | null;
  error: Error | null;
};

function parseChainId(caip2: string | undefined) {
  if (!caip2) {
    return null;
  }
  const [namespace, reference] = caip2.split(":");
  if (namespace !== "eip155" || !reference) {
    return null;
  }
  const chainId = Number(reference);
  return Number.isFinite(chainId) ? chainId : null;
}

function resolveChain(chainId: string | undefined): Chain | undefined {
  const numericId = parseChainId(chainId);
  if (numericId === celo.id) {
    return celo;
  }
  return undefined;
}

async function buildWalletClient(nextWallet: ConnectedWallet) {
  const nextProvider = await nextWallet.getEthereumProvider();
  const chain = resolveChain(nextWallet.chainId);
  return {
    provider: nextProvider,
    walletClient: createWalletClient({
      chain,
      transport: custom(nextProvider),
    }),
  };
}

export function usePrivyWalletClient(): UsePrivyWalletClientResult {
  const { ready, wallets } = useWallets();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(null);
  const [provider, setProvider] = useState<EIP1193Provider | null>(null);
  const [walletClient, setWalletClient] = useState<WalletClient | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const connectedWallet = wallets.find((item) => item.type === "ethereum") ?? null;
    setWallet(connectedWallet);
  }, [wallets]);

  useEffect(() => {
    let cancelled = false;

    if (!wallet) {
      setProvider(null);
      setWalletClient(null);
      return () => {
        cancelled = true;
      };
    }

    const connectWalletProvider = async () => {
      try {
        const result = await buildWalletClient(wallet);
        if (cancelled) {
          return;
        }
        setProvider(result.provider);
        setWalletClient(result.walletClient);
        setError(null);
      } catch (caught) {
        if (cancelled) {
          return;
        }
        setProvider(null);
        setWalletClient(null);
        setError(caught instanceof Error ? caught : new Error("Failed to connect wallet provider"));
      }
    };

    void connectWalletProvider();

    return () => {
      cancelled = true;
    };
  }, [wallet]);

  return {
    ready,
    wallet,
    provider,
    walletClient,
    error,
  };
}
