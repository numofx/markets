import { parseAbi } from "viem";

// Minimal Cauldron ABI surface needed for client-side vault discovery.
export const cauldronAbi = parseAbi([
  // Emitted when a new vault is built.
  "event VaultBuilt(bytes12 indexed vaultId, address indexed owner, bytes6 indexed seriesId, bytes6 ilkId)",
]);
