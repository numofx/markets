"use client";

import * as React from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { celo } from "@privy-io/chains";

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={process.env.NEXT_PUBLIC_PRIVY_APP_ID!}
      config={{
        loginMethods: ["email", "wallet"],
        supportedChains: [celo],
        defaultChain: celo,
        shouldEnforceDefaultChainOnConnect: true,
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
