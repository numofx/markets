"use client";

import { useEffect, useState } from "react";
import type { Address, Hex, WalletClient } from "viem";
import { formatUnits, parseUnits } from "viem";
import { BorrowFormView } from "@/components/BorrowFormView";
import { CELO_RPC_URL, publicClient } from "@/lib/celoClients";
import { useBorrowVaultId } from "@/lib/useBorrowVaultId";
import { useBorrowWalletData } from "@/lib/useBorrowWalletData";
import { usePrivyAddress } from "@/lib/usePrivyAddress";
import { usePrivyWalletClient } from "@/lib/usePrivyWalletClient";
import {
  approveUsdtJoin,
  buildVault,
  pour,
  readBasePoolConsistency,
  sellFyKes,
} from "@/src/borrow-actions";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { quoteFyForKes } from "@/src/borrow-quote";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

type BorrowFormProps = {
  className?: string;
};

function safeParseAmount(value: string, decimals: number) {
  const numeric = Number.parseFloat(value);
  if (!value || Number.isNaN(numeric) || numeric <= 0) {
    return null;
  }
  try {
    return parseUnits(value, decimals);
  } catch {
    return null;
  }
}

async function runBorrowFlow(params: {
  account: Address;
  walletClient: WalletClient;
  collateral: bigint;
  borrowKesDesired: bigint;
  allowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  onStatus: (status: string) => void;
  onTxHash: (hash: Hex) => void;
  persistVaultId: (vaultId: Hex) => void;
}) {
  const needsApproval = params.allowance === null || params.allowance < params.collateral;
  if (needsApproval) {
    params.onStatus("Step 1/3: Approving USDT…");
    const approval = await approveUsdtJoin({
      account: params.account,
      amount: params.collateral,
      walletClient: params.walletClient,
    });
    params.onTxHash(approval.txHash);
  }

  let nextVaultId: Hex | null = params.vaultId;
  if (!nextVaultId) {
    params.onStatus("Step 2/3: Building vault…");
    const built = await buildVault({ account: params.account, walletClient: params.walletClient });
    nextVaultId = built.vaultId;
    params.onTxHash(built.txHash);
    params.persistVaultId(nextVaultId);
    if (typeof window !== "undefined" && params.storageKey) {
      window.localStorage.setItem(params.storageKey, nextVaultId);
    }
  }
  if (!nextVaultId) {
    throw new Error("Vault unavailable.");
  }

  const quote = await quoteFyForKes(params.borrowKesDesired);
  if (quote.fyToBorrow <= 0n) {
    throw new Error("Quote unavailable.");
  }

  // We mint fyKESm directly into the pool and immediately sell it for KESm.
  // This makes the UX feel like borrowing KESm, while the debt is still denominated in fyKESm.
  params.onStatus("Step 3/4: Supplying collateral and borrowing…");
  const result = await pour({
    account: params.account,
    art: quote.fyToBorrow,
    ink: params.collateral,
    to: CELO_YIELD_POOL.poolAddress as Address,
    vaultId: nextVaultId,
    walletClient: params.walletClient,
  });
  params.onTxHash(result.txHash);

  const slippageBps = 50n;
  const minKesOut = (params.borrowKesDesired * (10_000n - slippageBps)) / 10_000n;
  params.onStatus("Step 4/4: Swapping fyKESm into KESm…");
  const swapResult = await sellFyKes({
    account: params.account,
    minKesOut,
    walletClient: params.walletClient,
  });
  params.onTxHash(swapResult.txHash);

  return { vaultId: nextVaultId };
}

function getBorrowValidationError(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  collateral: bigint | null;
  borrow: bigint | null;
  usdtBalance: bigint | null;
}) {
  if (!params.userAddress) {
    return "Connect wallet to continue.";
  }
  if (!params.walletClient) {
    return "Wallet client unavailable.";
  }
  if (!(params.collateral && params.borrow)) {
    return "Enter collateral and borrow amounts.";
  }
  if (params.usdtBalance !== null && params.collateral > params.usdtBalance) {
    return "Insufficient USDT balance.";
  }
  return null;
}

async function submitBorrowPosition(params: {
  userAddress?: Address;
  walletClient: WalletClient | null;
  parsedCollateral: bigint | null;
  parsedBorrowKes: bigint | null;
  usdtAllowance: bigint | null;
  vaultId: Hex | null;
  storageKey: string | null;
  setVaultId: (vaultId: Hex | null) => void;
  setIsSubmitting: (value: boolean) => void;
  setTxStatus: (value: string | null) => void;
  setTxHash: (value: Hex | null) => void;
  refetch: (address: Address) => Promise<void>;
}) {
  if (!(params.userAddress && params.walletClient)) {
    return;
  }
  if (!(params.parsedCollateral && params.parsedBorrowKes)) {
    return;
  }

  params.setIsSubmitting(true);
  params.setTxStatus(null);
  params.setTxHash(null);

  try {
    const flow = await runBorrowFlow({
      account: params.userAddress,
      allowance: params.usdtAllowance,
      borrowKesDesired: params.parsedBorrowKes,
      collateral: params.parsedCollateral,
      onStatus: (status) => params.setTxStatus(status),
      onTxHash: (hash) => params.setTxHash(hash),
      persistVaultId: (next) => params.setVaultId(next),
      storageKey: params.storageKey,
      vaultId: params.vaultId,
      walletClient: params.walletClient,
    });
    params.setTxStatus("Position updated.");
    params.setVaultId(flow.vaultId);
    await params.refetch(params.userAddress);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Borrow failed.";
    params.setTxStatus(message);
  } finally {
    params.setIsSubmitting(false);
  }
}

export function BorrowForm({ className }: BorrowFormProps) {
  const userAddress = usePrivyAddress();
  const { isCelo, walletClient } = usePrivyWalletClient();

  const [appChainId, setAppChainId] = useState<number | null>(null);
  const [basePoolConsistency, setBasePoolConsistency] = useState<{
    configuredPool: Address;
    onchainPool: Address;
    matches: boolean;
    seriesId: string;
  } | null>(null);

  const [collateralInput, setCollateralInput] = useState("");
  const [borrowInput, setBorrowInput] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txStatus, setTxStatus] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const { storageKey, vaultId, setVaultId } = useBorrowVaultId({
    ilkId: BORROW_CONFIG.ilk.usdt,
    seriesId: BORROW_CONFIG.seriesId.fyKesm,
    userAddress,
  });

  const { kesBalance, kesDecimals, lastError, refetch, usdtAllowance, usdtBalance, usdtDecimals } =
    useBorrowWalletData({
      fyToken: BORROW_CONFIG.tokens.fyKesm as Address,
      kesToken: BORROW_CONFIG.tokens.kesm as Address,
      usdtJoin: BORROW_CONFIG.joins.usdt as Address,
      usdtToken: BORROW_CONFIG.tokens.usdt as Address,
      userAddress,
    });

  const parsedCollateral = safeParseAmount(collateralInput, usdtDecimals);
  const parsedBorrowKes = safeParseAmount(borrowInput, kesDecimals);

  const collateralBalanceLabel =
    usdtBalance === null ? "—" : `${formatUnits(usdtBalance, usdtDecimals)} USDT`;
  const kesBalanceLabel =
    kesBalance === null ? "—" : `${formatUnits(kesBalance, kesDecimals)} KESm`;

  const ltvPercent =
    parsedCollateral && parsedBorrowKes && parsedCollateral !== 0n
      ? Number((parsedBorrowKes * 10_000n) / parsedCollateral) / 100
      : null;

  const validationError = getBorrowValidationError({
    borrow: parsedBorrowKes,
    collateral: parsedCollateral,
    usdtBalance,
    userAddress,
    walletClient,
  });

  const networkError = isCelo ? null : "Switch wallet network to Celo (42220).";
  const submitError = networkError ?? validationError;

  const maxCollateralLabel = usdtBalance === null ? null : formatUnits(usdtBalance, usdtDecimals);

  useEffect(() => {
    let cancelled = false;
    void publicClient.getChainId().then(
      (id) => {
        if (cancelled) {
          return;
        }
        setAppChainId(id);
      },
      () => {
        if (cancelled) {
          return;
        }
        setAppChainId(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void readBasePoolConsistency()
      .then((result) => {
        if (!cancelled) {
          setBasePoolConsistency(result);
        }
      })
      .catch(() => {
        // Best-effort diagnostic read only.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <BorrowFormView
      borrowBalanceLabel={kesBalanceLabel}
      borrowInput={borrowInput}
      borrowTokenSymbol="KESm"
      borrowValueLabel="Borrow KESm (we swap from fyKESm at pool price)."
      className={className}
      collateralBalanceLabel={collateralBalanceLabel}
      collateralInput={collateralInput}
      collateralUsdLabel={collateralInput || "0"}
      diagnostics={{
        appChainId,
        basePoolConfigured: basePoolConsistency?.configuredPool,
        basePoolMatches: basePoolConsistency?.matches,
        basePoolOnchain: basePoolConsistency?.onchainPool,
        basePoolSeriesId: basePoolConsistency?.seriesId,
        lastError,
        rpcUrl: CELO_RPC_URL,
        usdtBalance: usdtBalance === null ? "—" : formatUnits(usdtBalance, usdtDecimals),
        usdtBalanceRaw: usdtBalance === null ? "—" : usdtBalance.toString(),
        usdtDecimals,
        usdtToken: BORROW_CONFIG.tokens.usdt,
        userAddress,
      }}
      ltvLabel={ltvPercent === null ? "—" : `${ltvPercent.toFixed(2)}%`}
      maxCollateralDisabled={usdtBalance === null || usdtBalance === 0n}
      onBorrowChange={(value) => setBorrowInput(value)}
      onCollateralChange={(value) => setCollateralInput(value)}
      onMaxCollateral={() => {
        if (!maxCollateralLabel) {
          return;
        }
        setCollateralInput(maxCollateralLabel);
      }}
      onSubmit={() =>
        void submitBorrowPosition({
          parsedBorrowKes,
          parsedCollateral,
          refetch,
          setIsSubmitting,
          setTxHash,
          setTxStatus,
          setVaultId,
          storageKey,
          usdtAllowance,
          userAddress,
          vaultId,
          walletClient,
        })
      }
      submitDisabled={Boolean(submitError) || isSubmitting}
      submitLabel={isSubmitting ? "Submitting…" : (submitError ?? "Supply and Borrow")}
      txHash={txHash}
      txStatus={txStatus}
      vaultReady={Boolean(vaultId)}
    />
  );
}
