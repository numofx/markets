export const WAD = 10n ** 18n;
export const SECONDS_PER_YEAR = 31_536_000n;

export function aprFromPriceWad(pWad: bigint, secondsToMaturity: bigint): bigint | null {
  if (pWad <= 0n || secondsToMaturity <= 0n) {
    return null;
  }

  const invP = (WAD * WAD) / pWad;
  const excess = invP - WAD;
  if (excess <= 0n) {
    return null;
  }

  const tYearsWad = (secondsToMaturity * WAD) / SECONDS_PER_YEAR;
  if (tYearsWad <= 0n) {
    return null;
  }

  return (excess * WAD) / tYearsWad;
}

export function formatAprPercent(aprWad: bigint | null): string {
  if (!aprWad || aprWad <= 0n) {
    return "—";
  }
  const percent = Number(aprWad) / 1e16;
  if (!Number.isFinite(percent)) {
    return "—";
  }
  return `${percent.toFixed(2)}%`;
}
