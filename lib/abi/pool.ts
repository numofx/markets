import { parseAbi } from "viem";

export const poolAbi = parseAbi([
  "function baseToken() view returns (address)",
  "function fyToken() view returns (address)",
  "function baseDecimals() view returns (uint256)",
  "function maturity() view returns (uint32)",
  // Yield v2 pool fee parameters (64.64 fixed point, g1 <= 2^64 <= g2). See pools using YieldSpace math.
  "function g1() view returns (uint128)",
  "function g2() view returns (uint128)",
  "function getCache() view returns (uint112 baseCached, uint112 fyTokenCached, uint32 blockTimestampLast)",
  "function mint(address to, address remainder, uint256 minRatio, uint256 maxRatio) returns (uint256 baseIn, uint256 fyTokenIn, uint256 minted)",
  "function getBaseBalance() view returns (uint128)",
  "function getFYTokenBalance() view returns (uint128)",
  "function sellBase(address to, uint128 min) returns (uint128)",
  "function sellBasePreview(uint128) view returns (uint128)",
  "function sellFYToken(address to, uint128 min) returns (uint128)",
  "function sellFYTokenPreview(uint128) view returns (uint128)",
]);
