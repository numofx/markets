import { parseAbi } from "viem";

// Celo onchain registry for resolving core contract addresses (e.g. SortedOracles).
export const celoRegistryAbi = parseAbi([
  "function getAddressForOrDie(bytes32) view returns (address)",
]);
