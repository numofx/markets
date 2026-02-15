import type { Address, Hex, WalletClient } from "viem";
import { base, celo } from "viem/chains";
import { erc20Abi } from "@/lib/abi/erc20";
import { ladleAbi } from "@/lib/abi/ladle";
import { poolAbi } from "@/lib/abi/pool";
import { publicClient as basePublicClient } from "@/lib/baseClients";
import { publicClient as celoPublicClient } from "@/lib/celoClients";
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

type SupportedBorrowChainId = 8453 | 42_220;

function resolveChainRuntime(chainId: SupportedBorrowChainId) {
  if (chainId === 8453) {
    return { chain: base, publicClient: basePublicClient };
  }
  return { chain: celo, publicClient: celoPublicClient };
}

export async function approveTokenToSpender(params: {
  walletClient: WalletClient;
  account: Address;
  token: Address;
  spender: Address;
  amount: bigint;
  chainId: SupportedBorrowChainId;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const { chain, publicClient } = resolveChainRuntime(params.chainId);
  const txHash = await params.walletClient.writeContract({
    abi: erc20Abi,
    account: params.account,
    address: params.token,
    args: [params.spender, params.amount],
    chain,
    functionName: "approve",
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export function approveUsdtJoin(params: {
  walletClient: WalletClient;
  account: Address;
  amount: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  return approveTokenToSpender({
    account: params.account,
    amount: params.amount,
    chainId: 42_220,
    nonce: params.nonce,
    spender: BORROW_CONFIG.joins.usdt as Address,
    token: BORROW_CONFIG.tokens.usdt as Address,
    walletClient: params.walletClient,
  });
}

export async function readBasePoolConsistency() {
  const configuredPool = BORROW_CONFIG.baseCngn.pool.address as Address;
  const onchainPool = (await basePublicClient.readContract({
    abi: ladleAbi,
    address: BORROW_CONFIG.baseCngn.core.ladle as Address,
    args: [BORROW_CONFIG.baseCngn.seriesId.fycNgn as Hex],
    functionName: "pools",
  })) as Address;

  return {
    configuredPool,
    matches: onchainPool.toLowerCase() === configuredPool.toLowerCase(),
    onchainPool,
    seriesId: BORROW_CONFIG.baseCngn.seriesId.fycNgn,
  };
}

export async function buildVaultForMarket(params: {
  walletClient: WalletClient;
  account: Address;
  ladle: Address;
  seriesId: Hex;
  ilkId: Hex;
  chainId: SupportedBorrowChainId;
  salt?: number;
  nonce?: number;
}): Promise<BuildVaultResult> {
  const { chain, publicClient } = resolveChainRuntime(params.chainId);
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: params.ladle,
    args: [params.seriesId, params.ilkId, params.salt ?? 0],
    functionName: "build",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash, vaultId: simulation.result as Hex };
}

export function buildVault(params: {
  walletClient: WalletClient;
  account: Address;
  nonce?: number;
}): Promise<BuildVaultResult> {
  return buildVaultForMarket({
    account: params.account,
    chainId: 42_220,
    ilkId: BORROW_CONFIG.ilk.usdt as Hex,
    ladle: BORROW_CONFIG.core.ladle as Address,
    nonce: params.nonce,
    seriesId: BORROW_CONFIG.seriesId.fyKesm as Hex,
    walletClient: params.walletClient,
  });
}

export async function pourForMarket(params: {
  walletClient: WalletClient;
  account: Address;
  ladle: Address;
  chainId: SupportedBorrowChainId;
  vaultId: Hex;
  to?: Address;
  ink: bigint;
  art: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const { chain, publicClient } = resolveChainRuntime(params.chainId);
  const simulation = await publicClient.simulateContract({
    abi: ladleAbi,
    account: params.account,
    address: params.ladle,
    args: [params.vaultId, params.to ?? params.account, params.ink, params.art],
    functionName: "pour",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export function pour(params: {
  walletClient: WalletClient;
  account: Address;
  vaultId: Hex;
  to?: Address;
  ink: bigint;
  art: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  return pourForMarket({
    account: params.account,
    art: params.art,
    chainId: 42_220,
    ink: params.ink,
    ladle: BORROW_CONFIG.core.ladle as Address,
    nonce: params.nonce,
    to: params.to,
    vaultId: params.vaultId,
    walletClient: params.walletClient,
  });
}

export function previewSellFyToken(params: {
  chainId: SupportedBorrowChainId;
  poolAddress: Address;
  fyIn: bigint;
}): Promise<bigint> {
  const { publicClient } = resolveChainRuntime(params.chainId);
  return publicClient.readContract({
    abi: poolAbi,
    address: params.poolAddress,
    args: [params.fyIn],
    functionName: "sellFYTokenPreview",
  });
}

export function previewSellFyKes(fyIn: bigint): Promise<bigint> {
  return previewSellFyToken({
    chainId: 42_220,
    fyIn,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
  });
}

export async function sellFyTokenForMarket(params: {
  walletClient: WalletClient;
  account: Address;
  minBaseOut: bigint;
  poolAddress: Address;
  chainId: SupportedBorrowChainId;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const { chain, publicClient } = resolveChainRuntime(params.chainId);
  const simulation = await publicClient.simulateContract({
    abi: poolAbi,
    account: params.account,
    address: params.poolAddress,
    args: [params.account, params.minBaseOut],
    functionName: "sellFYToken",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export function sellFyKes(params: {
  walletClient: WalletClient;
  account: Address;
  minKesOut: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  return sellFyTokenForMarket({
    account: params.account,
    chainId: 42_220,
    minBaseOut: params.minKesOut,
    nonce: params.nonce,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
    walletClient: params.walletClient,
  });
}

export async function sellBaseTokenForMarket(params: {
  walletClient: WalletClient;
  account: Address;
  minFyOut: bigint;
  poolAddress: Address;
  chainId: SupportedBorrowChainId;
  nonce?: number;
}): Promise<BorrowTxResult> {
  const { chain, publicClient } = resolveChainRuntime(params.chainId);
  const simulation = await publicClient.simulateContract({
    abi: poolAbi,
    account: params.account,
    address: params.poolAddress,
    args: [params.account, params.minFyOut],
    functionName: "sellBase",
  });
  const txHash = await params.walletClient.writeContract({
    ...simulation.request,
    chain,
    nonce: params.nonce,
  });
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  return { txHash };
}

export function sellBaseKes(params: {
  walletClient: WalletClient;
  account: Address;
  minFyOut: bigint;
  nonce?: number;
}): Promise<BorrowTxResult> {
  return sellBaseTokenForMarket({
    account: params.account,
    chainId: 42_220,
    minFyOut: params.minFyOut,
    nonce: params.nonce,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
    walletClient: params.walletClient,
  });
}

export async function readBorrowPoolStateForMarket(params: {
  chainId: SupportedBorrowChainId;
  poolAddress: Address;
}): Promise<BorrowPoolState> {
  const { publicClient } = resolveChainRuntime(params.chainId);
  const poolAddress = params.poolAddress;
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

export function readBorrowPoolState(): Promise<BorrowPoolState> {
  return readBorrowPoolStateForMarket({
    chainId: 42_220,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
  });
}

export async function recoverBorrowPoolForMarket(params: {
  walletClient: WalletClient;
  account: Address;
  chainId: SupportedBorrowChainId;
  poolAddress: Address;
  onStatus?: (status: string) => void;
  onTxHash?: (hash: Hex) => void;
}) {
  const { publicClient } = resolveChainRuntime(params.chainId);
  let state = await readBorrowPoolStateForMarket({
    chainId: params.chainId,
    poolAddress: params.poolAddress,
  });
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
    params.onStatus?.("Fixing pool: selling pending fy…");
    const tx = await sellFyTokenForMarket({
      account: params.account,
      chainId: params.chainId,
      minBaseOut: 0n,
      nonce,
      poolAddress: params.poolAddress,
      walletClient: params.walletClient,
    });
    nonce += 1;
    params.onTxHash?.(tx.txHash);
    state = await readBorrowPoolStateForMarket({
      chainId: params.chainId,
      poolAddress: params.poolAddress,
    });
  }

  if (state.pendingBase > 0n) {
    params.onStatus?.("Fixing pool: selling pending base…");
    const tx = await sellBaseTokenForMarket({
      account: params.account,
      chainId: params.chainId,
      minFyOut: 0n,
      nonce,
      poolAddress: params.poolAddress,
      walletClient: params.walletClient,
    });
    params.onTxHash?.(tx.txHash);
    state = await readBorrowPoolStateForMarket({
      chainId: params.chainId,
      poolAddress: params.poolAddress,
    });
  }

  const cleaned = !state.cachedGtLive && state.pendingBase === 0n && state.pendingFy === 0n;
  return { cleaned, reason: cleaned ? ("CLEANED" as const) : ("STILL_DIRTY" as const), state };
}

export function recoverBorrowPool(params: {
  walletClient: WalletClient;
  account: Address;
  onStatus?: (status: string) => void;
  onTxHash?: (hash: Hex) => void;
}) {
  return recoverBorrowPoolForMarket({
    account: params.account,
    chainId: 42_220,
    onStatus: params.onStatus,
    onTxHash: params.onTxHash,
    poolAddress: CELO_YIELD_POOL.poolAddress as Address,
    walletClient: params.walletClient,
  });
}
