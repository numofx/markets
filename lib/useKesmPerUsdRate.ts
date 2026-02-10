"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { keccak256, stringToHex } from "viem";
import { celoRegistryAbi } from "@/lib/abi/celoRegistry";
import { sortedOraclesAbi } from "@/lib/abi/sortedOracles";
import { publicClient } from "@/lib/celoClients";
import { WAD } from "@/src/apr";
import { BORROW_CONFIG } from "@/src/borrow-config";

const CELO_REGISTRY_ADDRESS = "0x000000000000000000000000000000000000ce10" as const;
const SORTED_ORACLES_ID = keccak256(stringToHex("SortedOracles"));

// cUSD is a practical onchain USD proxy for FX conversion.
const CUSD_ADDRESS = "0x765DE816845861e75A25fCA122bb6898B8B1282a" as const;

export type KesmPerUsdRateResult = {
  kesmPerUsdWad: bigint | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
};

function safeDivWad(numeratorWad: bigint, denominatorWad: bigint) {
  if (denominatorWad <= 0n) {
    return null;
  }
  return (numeratorWad * WAD) / denominatorWad;
}

function getSortedOraclesAddress() {
  return publicClient.readContract({
    abi: celoRegistryAbi,
    address: CELO_REGISTRY_ADDRESS,
    args: [SORTED_ORACLES_ID],
    functionName: "getAddressForOrDie",
  });
}

async function readCeloPerTokenWad(sortedOracles: Address, token: Address) {
  const expiredResult = await publicClient.readContract({
    abi: sortedOraclesAbi,
    address: sortedOracles,
    args: [token],
    functionName: "isOldestReportExpired",
  });
  const expired = expiredResult[0];
  if (expired) {
    return null;
  }

  const [rate, denominator] = await publicClient.readContract({
    abi: sortedOraclesAbi,
    address: sortedOracles,
    args: [token],
    functionName: "medianRate",
  });
  if (rate <= 0n) {
    return null;
  }
  // See Celo onchain oracle adapters: CELO per token = denominator / rate.
  return (denominator * WAD) / rate;
}

async function fetchKesmPerUsdWad() {
  const sortedOracles = (await getSortedOraclesAddress()) as Address;

  const [celoPerUsdWad, celoPerKesmWad] = await Promise.all([
    readCeloPerTokenWad(sortedOracles, CUSD_ADDRESS as Address),
    readCeloPerTokenWad(sortedOracles, BORROW_CONFIG.tokens.kesm as Address),
  ]);

  return celoPerUsdWad && celoPerKesmWad ? safeDivWad(celoPerUsdWad, celoPerKesmWad) : null;
}

export function useKesmPerUsdRate(): KesmPerUsdRateResult {
  const [state, setState] = useState<KesmPerUsdRateResult>({
    error: null,
    kesmPerUsdWad: null,
    status: "idle",
  });

  useEffect(() => {
    let cancelled = false;
    setState((prev) => ({ ...prev, error: null, status: "loading" }));

    void (async () => {
      try {
        const kesmPerUsdWad = await fetchKesmPerUsdWad();

        if (cancelled) {
          return;
        }
        setState({
          error: null,
          kesmPerUsdWad,
          status: "ready",
        });
      } catch (caught) {
        if (cancelled) {
          return;
        }
        const message =
          caught instanceof Error ? caught.message : "Failed to read KESm/USD oracle rate.";
        setState({ error: message, kesmPerUsdWad: null, status: "error" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
