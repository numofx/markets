"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";
import { parseAbiItem } from "viem";
import { publicClient } from "@/lib/celoClients";

const LOOKBACK_BLOCKS = 3_000_000n;
const vaultBuiltEvent = parseAbiItem(
  "event VaultBuilt(bytes12 indexed vaultId, address indexed owner, bytes6 indexed seriesId, bytes6 ilkId)"
);

export type BorrowVaultDiscoveryResult = {
  vaultId: Hex | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
};

function clampFromBlock(current: bigint) {
  return current > LOOKBACK_BLOCKS ? current - LOOKBACK_BLOCKS : 0n;
}

export function useBorrowVaultDiscovery(params: {
  userAddress?: Address;
  cauldronAddress: Address;
  seriesId: Hex;
  ilkId: Hex;
}): BorrowVaultDiscoveryResult {
  const [state, setState] = useState<BorrowVaultDiscoveryResult>({
    error: null,
    status: "idle",
    vaultId: null,
  });

  useEffect(() => {
    if (!params.userAddress) {
      setState({ error: null, status: "idle", vaultId: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, error: null, status: "loading" }));

    void (async () => {
      try {
        const toBlock = await publicClient.getBlockNumber();
        const fromBlock = clampFromBlock(toBlock);

        // VaultBuilt has indexed: vaultId, owner, seriesId. ilkId is in data, so we filter in JS.
        const logs = await publicClient.getLogs({
          address: params.cauldronAddress,
          args: {
            owner: params.userAddress,
            seriesId: params.seriesId,
          },
          event: vaultBuiltEvent,
          fromBlock,
          toBlock,
        });

        // Pick most recent matching ilk.
        const match = logs.reverse().find((log) => {
          const args = log.args as { ilkId?: Hex };
          return args.ilkId?.toLowerCase() === params.ilkId.toLowerCase();
        });

        if (cancelled) {
          return;
        }
        const vaultId = (match?.args as { vaultId?: Hex } | undefined)?.vaultId ?? null;
        setState({ error: null, status: "ready", vaultId });
      } catch (caught) {
        if (cancelled) {
          return;
        }
        const message =
          caught instanceof Error ? caught.message : "Failed to discover existing vault.";
        setState({ error: message, status: "error", vaultId: null });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.cauldronAddress, params.ilkId, params.seriesId, params.userAddress]);

  return state;
}
