"use client";

import { useEffect, useState } from "react";
import type { Address, Hex } from "viem";

export type UseBorrowVaultIdResult = {
  storageKey: string | null;
  vaultId: Hex | null;
  setVaultId: (vaultId: Hex | null) => void;
};

export function useBorrowVaultId(params: {
  userAddress?: Address;
  seriesId: string;
  ilkId: string;
}): UseBorrowVaultIdResult {
  const storageKey = params.userAddress
    ? `numo:borrow:vaultId:${params.userAddress}:${params.seriesId}:${params.ilkId}`
    : null;

  const [vaultId, setVaultId] = useState<Hex | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!storageKey) {
      setVaultId(null);
      return;
    }
    const cached = window.localStorage.getItem(storageKey);
    setVaultId(cached ? (cached as Hex) : null);
  }, [storageKey]);

  return { setVaultId, storageKey, vaultId };
}
