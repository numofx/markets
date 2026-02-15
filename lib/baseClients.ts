"use client";

import { createPublicClient, fallback, http } from "viem";
import { base } from "viem/chains";

const fallbackUrl = "https://mainnet.base.org";
const fallbackUrl2 = "https://base-rpc.publicnode.com";
const envUrl = process.env.NEXT_PUBLIC_BASE_RPC_URL;
const isPlaceholder =
  envUrl === "https://your_base_rpc/" ||
  envUrl === "http://your_base_rpc/" ||
  envUrl === "your_base_rpc" ||
  envUrl === "YOUR_BASE_RPC";
const rpcUrl = !envUrl || isPlaceholder ? fallbackUrl : envUrl;

export const BASE_RPC_URL = rpcUrl;

if (isPlaceholder) {
  // eslint-disable-next-line no-console
  console.warn(
    "[baseClients] NEXT_PUBLIC_BASE_RPC_URL is a placeholder. Falling back to https://mainnet.base.org"
  );
}

if (process.env.NODE_ENV === "development") {
  console.assert(
    rpcUrl.startsWith("https://"),
    "NEXT_PUBLIC_BASE_RPC_URL must be set to a valid HTTPS URL"
  );
}

export const publicClient = createPublicClient({
  batch: { multicall: true },
  chain: base,
  transport: fallback(
    [...new Set([rpcUrl, fallbackUrl, fallbackUrl2])].map((url) =>
      http(url, {
        retryCount: 3,
        retryDelay: 500,
        timeout: 15_000,
      })
    )
  ),
});
