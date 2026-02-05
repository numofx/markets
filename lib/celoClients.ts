"use client";

import { createPublicClient, http } from "viem";
import { celo } from "viem/chains";

const rpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL;

if (!rpcUrl) {
  throw new Error("Missing NEXT_PUBLIC_CELO_RPC_URL");
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
