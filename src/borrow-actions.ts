import { BORROW_CONFIG } from "@/src/borrow-config";

type BorrowActionResult = {
  txHash: string;
  steps: string[];
};

function mockTxHash() {
  const entropy = Math.random().toString(16).slice(2, 10);
  return `0x${entropy.padEnd(8, "0")}`;
}

async function mockDelay() {
  await new Promise((resolve) => setTimeout(resolve, 600));
}

export async function createVault(): Promise<BorrowActionResult & { vaultId: string }> {
  await mockDelay();
  return {
    steps: ["Tx 1 — Create vault (build): Ladle.build(seriesId, ilkId, salt=0)"],
    txHash: mockTxHash(),
    vaultId: `vault-${Date.now()}`,
  };
}

export async function depositUsdt(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return {
    steps: [
      "Tx 2 — Approve (tx): ERC20.approve(usdtJoin, amount6) (USDT = 6 decimals).",
      "Tx 2 — Ladle.pour (ink) (tx): Ladle.pour(vaultId, to, amount6, art=0) (USDT = 6 decimals)",
      "Example: deposit 10 USDT → amount6 = 10,000,000; pour ink = +10,000,000; art = 0.",
      "Optional — One-tx batch: You can batch approve + join + pour in one transaction (if your wallet supports batching), but the underlying actions are the same.",
    ],
    txHash: mockTxHash(),
  };
}

export async function borrowFyKes(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return {
    steps: [
      "Tx 3 — Ladle.pour (art): Ladle.pour(vaultId, to, ink=0, art18)",
      "Example: borrow 10 fyKESm → art18 = 10 * 10^18; pour ink = 0; art = +10e18.",
    ],
    txHash: mockTxHash(),
  };
}

export async function repayFyKes(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return {
    steps: [
      "Tx 4 — Repay (tx): ERC20.approve(fyKESmJoin?, art18) (if needed by your integration).",
      "Tx 4 — Ladle.pour (art negative) (tx): Ladle.pour(vaultId, to, ink=0, art=-art18)",
    ],
    txHash: mockTxHash(),
  };
}

export async function withdrawUsdt(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return {
    steps: [
      "Tx 5 — Ladle.pour (ink negative) (tx): Ladle.pour(vaultId, to, ink=-amount6, art=0) (USDT = 6 decimals)",
      "Tx 5 — Ladle.exit (USDT) (tx): Ladle.exit(to, amount6) (USDT = 6 decimals)",
    ],
    txHash: mockTxHash(),
  };
}
