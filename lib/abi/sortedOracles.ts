import { parseAbi } from "viem";

// Minimal ABI for pulling median oracle rates from Mento/Celo SortedOracles.
export const sortedOraclesAbi = parseAbi([
  "function medianRate(address) view returns (uint256 rate, uint256 denominator)",
  "function isOldestReportExpired(address) view returns (bool expired, uint256 oldestTimestamp)",
]);
