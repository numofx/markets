import { parseAbi } from "viem";

// Minimal Ladle ABI surface for borrowing against collateral.
// Matches the function signatures used in the borrow flow and user-provided cast examples.
export const ladleAbi = parseAbi([
  "function build(bytes6 seriesId, bytes6 ilkId, uint8 salt) returns (bytes12 vaultId)",
  "function pour(bytes12 vaultId, address to, int128 ink, int128 art)",
  "function pools(bytes6 seriesId) view returns (address)",
]);
