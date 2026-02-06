type BorrowActionResult = {
  txHash: string;
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
  return { txHash: mockTxHash(), vaultId: `vault-${Date.now()}` };
}

export async function depositUsdt(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return { txHash: mockTxHash() };
}

export async function borrowFyKes(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return { txHash: mockTxHash() };
}

export async function repayFyKes(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return { txHash: mockTxHash() };
}

export async function withdrawUsdt(amount: string): Promise<BorrowActionResult> {
  void amount;
  await mockDelay();
  return { txHash: mockTxHash() };
}
