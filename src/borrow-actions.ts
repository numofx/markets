import type { Address, Hex, WalletClient } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { ladleAbi } from "@/lib/abi/ladle";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient } from "@/lib/celoClients";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

export type BorrowTxResult = {
  txHash: Hex;
};

export type BuildVaultResult = BorrowTxResult & {
  vaultId: Hex;
};

export type BorrowPoolState = {
  baseCached: bigint;
  baseLive: bigint;
  cachedGtLive: boolean;
  fyCached: bigint;
  fyLive: bigint;
  pendingBase: bigint;
  pendingFy: bigint;
};

export async function approveUsdtJoin(params: {
  walletClient: WalletClient;
  account: Address;
  amount: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const txHash = await params.walletClient.writeContract({
    abi: erc20Abi,
    account: params.account,
    address: BORROW_CONFIG.tokens.usdt as Address,
    args: [BORROW_CONFIG.joins.usdt as Address, params.amount],
    chain: celo,
    functionName: "approve",
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export async function buildVault(params: {
  walletClient: WalletClient;
  account: Address;
  nonce?: number;
}): Promise<BuildVaultResult> {
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: BORROW_CONFIG.core.ladle as Address,
    args: [BORROW_CONFIG.seriesId.fyKesm as Hex, BORROW_CONFIG.ilk.usdt as Hex, 0],
    functionName: "build",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain: celo,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, vaultId: simulation.result as Hex };
}

export async function pour(params: {
  walletClient: WalletClient;
  account: Address;
  vaultId: Hex;
  to?: Address;
  ink: bigint;
  art: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: BORROW_CONFIG.core.ladle as Address,
    args: [params.vaultId, params.to ?? params.account, params.ink, params.art],
    functionName: "pour",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain: celo,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export function previewSellFyKes(fyIn: bigint): Promise<bigint> {
  return publicClient.readContract({
    abi: poolAbi,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [fyIn],
    functionName: "sellFYTokenPreview",
  });
}

export async function sellFyKes(params: {
  walletClient: WalletClient;
  account: Address;
  minKesOut: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const simulation = await publicClient.simulateContract({
    abi: poolAbi,
    account: params.account,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [params.account, params.minKesOut],
    functionName: "sellFYToken",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain: celo,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export async function sellBaseKes(params: {
  walletClient: WalletClient;
  account: Address;
  minFyOut: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const simulation = await publicClient.simulateContract({
    abi: poolAbi,
    account: params.account,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [params.account, params.minFyOut],
    functionName: "sellBase",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain: celo,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export async function readBorrowPoolState(): Promise<BorrowPoolState> {
  const poolAddress = CELO_YIELD_POOL.poolAddress as Address;
  const [baseToken, fyToken, cache] = await Promise.all([
    publicClient.readContract({
      abi: poolAbi,
      address: poolAddress,
      functionName: "baseToken",
    }),
    publicClient.readContract({
      abi: poolAbi,
      address: poolAddress,
      functionName: "fyToken",
    }),
    publicClient.readContract({
      abi: poolAbi,
      address: poolAddress,
      functionName: "getCache",
    }),
  ]);
  const [baseCached, fyCached] = cache;
  const [baseLive, fyLive] = await Promise.all([
    publicClient.readContract({
      abi: erc20Abi,
      address: baseToken,
      args: [poolAddress],
      functionName: "balanceOf",
    }),
    publicClient.readContract({
      abi: erc20Abi,
      address: fyToken,
      args: [poolAddress],
      functionName: "balanceOf",
    }),
  ]);
  const cachedGtLive = baseCached > baseLive || fyCached > fyLive;
  const pendingBase = baseLive > baseCached ? baseLive - baseCached : 0n;
  const pendingFy = fyLive > fyCached ? fyLive - fyCached : 0n;
  return { baseCached, baseLive, cachedGtLive, fyCached, fyLive, pendingBase, pendingFy };
}

export async function recoverBorrowPool(params: {
  walletClient: WalletClient;
  account: Address;
  onStatus?: (status: string) => void;
  onTxHash?: (hash: Hex) => void;
}) {
  let state = await readBorrowPoolState();
  if (state.cachedGtLive) {
    return { cleaned: false as const, reason: "CACHE_GT_LIVE" as const, state };
  }
  if (state.pendingBase === 0n && state.pendingFy === 0n) {
    return { cleaned: true as const, reason: "ALREADY_CLEAN" as const, state };
  }

  let nonce = await publicClient.getTransactionCount({
    address: params.account,
    blockTag: "pending",
  });

  if (state.pendingFy > 0n) {
    params.onStatus?.("Fixing pool: selling pending fyKESm…");
    const tx = await sellFyKes({
      account: params.account,
      minKesOut: 0n,
      nonce,
      walletClient: params.walletClient,
    });
    nonce += 1;
    params.onTxHash?.(tx.txHash);
    state = await readBorrowPoolState();
  }

  if (state.pendingBase > 0n) {
    params.onStatus?.("Fixing pool: selling pending KESm…");
    const tx = await sellBaseKes({
      account: params.account,
      minFyOut: 0n,
      nonce,
      walletClient: params.walletClient,
    });
    params.onTxHash?.(tx.txHash);
    state = await readBorrowPoolState();
  }

  const cleaned = !state.cachedGtLive && state.pendingBase === 0n && state.pendingFy === 0n;
  return { cleaned, reason: cleaned ? ("CLEANED" as const) : ("STILL_DIRTY" as const), state };
}
