const REVERT_SELECTOR_REGEX = /0x[a-fA-F0-9]{8}/;

export function getRevertSelector(caught: unknown) {
  const maybeAny = caught as {
    data?: unknown;
    message?: string;
    shortMessage?: string;
    cause?: unknown;
    error?: unknown;
  };

  const candidateDataSources: unknown[] = [
    maybeAny?.data,
    (maybeAny?.cause as { data?: unknown } | undefined)?.data,
    (maybeAny?.error as { data?: unknown } | undefined)?.data,
    ((maybeAny?.error as { cause?: unknown } | undefined)?.cause as { data?: unknown } | undefined)
      ?.data,
  ];

  for (const source of candidateDataSources) {
    if (typeof source === "string" && source.startsWith("0x") && source.length >= 10) {
      return source.slice(0, 10);
    }
  }

  let messageForSelector = "";
  if (typeof maybeAny?.shortMessage === "string") {
    messageForSelector = maybeAny.shortMessage;
  } else if (typeof maybeAny?.message === "string") {
    messageForSelector = maybeAny.message;
  } else if (caught instanceof Error && caught.message) {
    messageForSelector = caught.message;
  }

  return messageForSelector.match(REVERT_SELECTOR_REGEX)?.[0] ?? null;
}
