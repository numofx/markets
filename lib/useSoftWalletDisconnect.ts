"use client";

import { useEffect, useState } from "react";

const SOFT_DISCONNECT_KEY = "numo:wallet-soft-disconnected";
const SOFT_DISCONNECT_EVENT = "numo:wallet-soft-disconnect-changed";

function readSoftDisconnected() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(SOFT_DISCONNECT_KEY) === "1";
}

export function useSoftWalletDisconnect() {
  const [softDisconnected, setSoftDisconnected] = useState(readSoftDisconnected);

  useEffect(() => {
    const sync = () => setSoftDisconnected(readSoftDisconnected());
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== SOFT_DISCONNECT_KEY) {
        return;
      }
      sync();
    };
    const handleCustom = () => sync();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(SOFT_DISCONNECT_EVENT, handleCustom);
    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(SOFT_DISCONNECT_EVENT, handleCustom);
    };
  }, []);

  const set = (value: boolean) => {
    if (typeof window === "undefined") {
      return;
    }
    if (value) {
      window.localStorage.setItem(SOFT_DISCONNECT_KEY, "1");
    } else {
      window.localStorage.removeItem(SOFT_DISCONNECT_KEY);
    }
    setSoftDisconnected(value);
    // storage events don't fire in the same tab, so broadcast locally too.
    window.dispatchEvent(new Event(SOFT_DISCONNECT_EVENT));
  };

  return { setSoftDisconnected: set, softDisconnected };
}
