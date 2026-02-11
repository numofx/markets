const DATA_SELECTOR_REGEX = /^0x([a-fA-F0-9]{8})/;
const MESSAGE_SELECTOR_PATTERNS = [
  /revert(?:ed)?\s*(?:with(?:\s+the)?(?:\s+following)?(?:\s+signature)?\s*:?)?\s*(0x[a-fA-F0-9]{8})/i,
  /signature\s*:\s*(0x[a-fA-F0-9]{8})/i,
  /selector\s*:\s*(0x[a-fA-F0-9]{8})/i,
  /error(?:\s+signature)?\s*(?:=|:)\s*(0x[a-fA-F0-9]{8})/i,
  /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{8})(?![a-fA-F0-9])/,
] as const;

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
    if (typeof source === "string") {
      const match = source.match(DATA_SELECTOR_REGEX);
      if (match) {
        return `0x${match[1]}`;
      }
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

  for (const pattern of MESSAGE_SELECTOR_PATTERNS) {
    const match = messageForSelector.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}
