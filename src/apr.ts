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
  // Truncate (not round) to 2 decimal places in percentage space.
  // aprWad is APR in WAD (1e18), so:
  // percentHundredths = floor(aprWad * 10000 / 1e18)
  const percentHundredths = (aprWad * 10_000n) / WAD;
  const integerPart = percentHundredths / 100n;
  const fractionalPart = percentHundredths % 100n;
  const groupedInteger = integerPart.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const paddedFraction = fractionalPart.toString().padStart(2, "0");
  return `${groupedInteger}.${paddedFraction}%`;
}
