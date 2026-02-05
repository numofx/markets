import { parseAbi } from "viem";

export const poolAbi = parseAbi([
  "function baseToken() view returns (address)",
  "function fyToken() view returns (address)",
  "function baseDecimals() view returns (uint256)",
  "function maturity() view returns (uint32)",
  "function getBaseBalance() view returns (uint128)",
  "function getFYTokenBalance() view returns (uint128)",
  "function sellBasePreview(uint128) view returns (uint128)",
]);
