"use client";

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const fallbackUrl = "https://forno.celo.org";
const envUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL;
const isPlaceholder =
  envUrl === "https://your_celo_rpc/" ||
  envUrl === "http://your_celo_rpc/" ||
  envUrl === "your_celo_rpc" ||
  envUrl === "YOUR_CELO_RPC";
const rpcUrl = !envUrl || isPlaceholder ? fallbackUrl : envUrl;

export const CELO_RPC_URL = rpcUrl;

if (isPlaceholder) {
  // eslint-disable-next-line no-console
  console.warn(
    "[celoClients] NEXT_PUBLIC_CELO_RPC_URL is a placeholder. Falling back to https://forno.celo.org"
  );
}

if (process.env.NODE_ENV === "development") {
  console.assert(
    rpcUrl.startsWith("https://"),
    "NEXT_PUBLIC_CELO_RPC_URL must be set to a valid HTTPS URL"
  );
}

export const publicClient = createPublicClient({
  chain: celo,
  transport: http(rpcUrl),
});
