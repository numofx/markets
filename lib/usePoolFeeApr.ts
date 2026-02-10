"use client";

import { useEffect, useState } from "react";

export type PoolFeeAprResult = {
  aprPercent: number | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

async function fetchPoolFeeAprPercent(): Promise<number | null> {
  const res = await fetch("/api/pool-fee-apr", { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Pool APR request failed (${res.status})`);
  }

  const json = (await res.json()) as { aprPercent?: unknown };
  return typeof json.aprPercent === "number" ? json.aprPercent : null;
}

export function usePoolFeeApr(): PoolFeeAprResult {
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [state, setState] = useState<Omit<PoolFeeAprResult, "refetch">>({
    aprPercent: null,
    error: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    // Refetch signal for this effect.
    void refreshIndex;

    setState((prev) => ({ ...prev, error: null, loading: true }));

    void fetchPoolFeeAprPercent()
      .then((aprPercent) => {
        if (cancelled) {
          return;
        }
        setState({ aprPercent, error: null, loading: false });
      })
      .catch((caught) => {
        if (cancelled) {
          return;
        }
        const message = caught instanceof Error ? caught.message : "Failed to load pool APR.";
        setState({ aprPercent: null, error: message, loading: false });
      });

    return () => {
      cancelled = true;
    };
  }, [refreshIndex]);

  return {
    ...state,
    refetch: () => setRefreshIndex((value) => value + 1),
  };
}
