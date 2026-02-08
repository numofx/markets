import type { Address, Hex, WalletClient } from "viem";
import { celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { poolAbi } from "@/lib/abi/pool";
import { ladleAbi } from "@/lib/abi/ladle";
import { publicClient } from "@/lib/celoClients";
import { BORROW_CONFIG } from "@/src/borrow-config";
import { CELO_YIELD_POOL } from "@/src/poolInfo";

export type BorrowTxResult = {
  txHash: Hex;
};

export type BuildVaultResult = BorrowTxResult & {
  vaultId: Hex;
};

export async function approveUsdtJoin(params: {
  walletClient: WalletClient;
  account: Address;
  amount: bigint;
}): Promise<BorrowTxResult> {
  const txHash = await params.walletClient.writeContract({
    abi: erc20Abi,
    account: params.account,
    address: BORROW_CONFIG.tokens.usdt as Address,
    args: [BORROW_CONFIG.joins.usdt as Address, params.amount],
    chain: celo,
    functionName: "approve",
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export async function buildVault(params: {
  walletClient: WalletClient;
  account: Address;
}): Promise<BuildVaultResult> {
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: BORROW_CONFIG.core.ladle as Address,
    args: [BORROW_CONFIG.seriesId.fyKesm as Hex, BORROW_CONFIG.ilk.usdt as Hex, 0],
    functionName: "build",
  });
  const txHash = await params.walletClient.writeContract(simulation.request);
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
}): Promise<BorrowTxResult> {
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: BORROW_CONFIG.core.ladle as Address,
    args: [params.vaultId, params.to ?? params.account, params.ink, params.art],
    functionName: "pour",
  });
  const txHash = await params.walletClient.writeContract(simulation.request);
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
}): Promise<BorrowTxResult> {
  const txHash = await params.walletClient.writeContract({
    abi: poolAbi,
    account: params.account,
    address: CELO_YIELD_POOL.poolAddress as Address,
    args: [params.account, params.minKesOut],
    chain: celo,
    functionName: "sellFYToken",
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}
