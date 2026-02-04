"use client";

import { celo } from "@privy-io/chains";
import { PrivyProvider } from "@privy-io/react-auth";
import type { ReactNode } from "react";

export default function Providers({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    throw new Error("Missing NEXT_PUBLIC_PRIVY_APP_ID");
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        defaultChain: celo,
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        loginMethods: ["email", "wallet"],
        supportedChains: [celo],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
