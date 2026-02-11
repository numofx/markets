import type { Address } from "viem";
import { decodeErrorResult, isAddress } from "viem";
import { poolAbi } from "@/lib/abi/pool";
import { yieldPoolMintHelperAbi } from "@/lib/abi/yieldPoolMintHelper";

const REVERT_SELECTOR_FROM_MESSAGE_REGEX = /(?:^|[^a-fA-F0-9])(0x[a-fA-F0-9]{8})(?![a-fA-F0-9])/;
const ERROR_ADDRESS_FROM_MESSAGE_REGEX = /address:\s*(0x[a-fA-F0-9]{40})/i;

export type RevertDecodeSource = "pool" | "helper" | "unknown";

export type MintErrorHint =
  | {
      kind: "notEnoughBase";
      selector: "0x68744619";
      baseAvailable: bigint;
      baseNeeded: bigint;
    }
  | {
      kind: "slippageDuringMint";
      selector: "0xd48b6b81";
      newRatio: bigint;
      minRatio: bigint;
      maxRatio: bigint;
    }
  | null;

export type RevertInfo = {
  contractAddress: Address | null;
  data: `0x${string}` | null;
  decodedAgainst: RevertDecodeSource;
  decodedArgs: readonly unknown[] | null;
  decodedErrorName: string | null;
  selector: `0x${string}` | null;
};

export function getRevertData(caught: unknown): `0x${string}` | null {
  const maybeAny = caught as {
    data?: unknown;
    cause?: unknown;
    error?: unknown;
  };

  const candidateDataSources: unknown[] = [
    maybeAny?.data,
    (maybeAny?.cause as { data?: unknown } | undefined)?.data,
    ((maybeAny?.cause as { cause?: unknown } | undefined)?.cause as { data?: unknown } | undefined)
      ?.data,
    (maybeAny?.error as { data?: unknown } | undefined)?.data,
    ((maybeAny?.error as { cause?: unknown } | undefined)?.cause as { data?: unknown } | undefined)
      ?.data,
  ];

  for (const source of candidateDataSources) {
    if (typeof source === "string" && source.startsWith("0x") && source.length >= 10) {
      return source as `0x${string}`;
    }
  }

  return null;
}

export function getErrorContractAddress(caught: unknown): Address | null {
  const maybeAny = caught as {
    address?: unknown;
    contractAddress?: unknown;
    cause?: unknown;
    error?: unknown;
    shortMessage?: string;
    message?: string;
  };

  const candidates: unknown[] = [
    maybeAny?.contractAddress,
    maybeAny?.address,
    (maybeAny?.cause as { contractAddress?: unknown; address?: unknown } | undefined)
      ?.contractAddress,
    (maybeAny?.cause as { contractAddress?: unknown; address?: unknown } | undefined)?.address,
    (maybeAny?.error as { contractAddress?: unknown; address?: unknown } | undefined)
      ?.contractAddress,
    (maybeAny?.error as { contractAddress?: unknown; address?: unknown } | undefined)?.address,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && isAddress(candidate)) {
      return candidate as Address;
    }
  }

  let message = "";
  if (typeof maybeAny?.shortMessage === "string") {
    message = maybeAny.shortMessage;
  } else if (typeof maybeAny?.message === "string") {
    message = maybeAny.message;
  }
  const match = message.match(ERROR_ADDRESS_FROM_MESSAGE_REGEX);
  if (match?.[1] && isAddress(match[1])) {
    return match[1] as Address;
  }

  return null;
}

function decodeAgainstKnownAbis(data: `0x${string}`): {
  decodedAgainst: RevertDecodeSource;
  decodedArgs: readonly unknown[] | null;
  decodedErrorName: string | null;
} {
  try {
    const decoded = decodeErrorResult({ abi: poolAbi, data });
    return {
      decodedAgainst: "pool",
      decodedArgs: decoded.args ?? null,
      decodedErrorName: decoded.errorName,
    };
  } catch {
    // try helper next
  }

  try {
    const decoded = decodeErrorResult({ abi: yieldPoolMintHelperAbi, data });
    return {
      decodedAgainst: "helper",
      decodedArgs: decoded.args ?? null,
      decodedErrorName: decoded.errorName,
    };
  } catch {
    return {
      decodedAgainst: "unknown",
      decodedArgs: null,
      decodedErrorName: null,
    };
  }
}

export function getRevertInfo(
  caught: unknown,
  context?: { helperAddress?: Address | null; poolAddress?: Address | null }
): RevertInfo {
  const data = getRevertData(caught);
  const contractAddress = getErrorContractAddress(caught);

  let decodeAgainstFromAddress: RevertDecodeSource = "unknown";
  if (
    contractAddress &&
    context?.poolAddress &&
    contractAddress.toLowerCase() === context.poolAddress.toLowerCase()
  ) {
    decodeAgainstFromAddress = "pool";
  } else if (
    contractAddress &&
    context?.helperAddress &&
    contractAddress.toLowerCase() === context.helperAddress.toLowerCase()
  ) {
    decodeAgainstFromAddress = "helper";
  }

  if (data !== null) {
    const decoded = decodeAgainstKnownAbis(data);
    return {
      contractAddress,
      data,
      decodedAgainst:
        decoded.decodedAgainst === "unknown" ? decodeAgainstFromAddress : decoded.decodedAgainst,
      decodedArgs: decoded.decodedArgs,
      decodedErrorName: decoded.decodedErrorName,
      selector: data.slice(0, 10) as `0x${string}`,
    };
  }

  const maybeAny = caught as { shortMessage?: string; message?: string };
  let messageForSelector = "";
  if (typeof maybeAny?.shortMessage === "string") {
    messageForSelector = maybeAny.shortMessage;
  } else if (typeof maybeAny?.message === "string") {
    messageForSelector = maybeAny.message;
  }
  const match = messageForSelector.match(REVERT_SELECTOR_FROM_MESSAGE_REGEX);

  return {
    contractAddress,
    data: null,
    decodedAgainst: decodeAgainstFromAddress,
    decodedArgs: null,
    decodedErrorName: null,
    selector: (match?.[1] as `0x${string}` | undefined) ?? null,
  };
}

export function decodeMintErrorHint(
  caught: unknown,
  context?: { helperAddress?: Address | null; poolAddress?: Address | null }
): MintErrorHint {
  const revertInfo = getRevertInfo(caught, context);
  const selector = revertInfo.selector;

  if (selector === "0x68744619" && revertInfo.decodedErrorName === "NotEnoughBaseIn") {
    const values = (revertInfo.decodedArgs ?? []) as readonly [bigint, bigint];
    return {
      baseAvailable: values[0],
      baseNeeded: values[1],
      kind: "notEnoughBase",
      selector: "0x68744619",
    };
  }

  if (selector === "0xd48b6b81" && revertInfo.decodedErrorName === "SlippageDuringMint") {
    const values = (revertInfo.decodedArgs ?? []) as readonly [bigint, bigint, bigint];
    return {
      kind: "slippageDuringMint",
      maxRatio: values[2],
      minRatio: values[1],
      newRatio: values[0],
      selector: "0xd48b6b81",
    };
  }

  // Selector-only fallback when source isn't helper.
  if (selector === "0x68744619" && revertInfo.decodedAgainst !== "helper") {
    return {
      baseAvailable: 0n,
      baseNeeded: 0n,
      kind: "notEnoughBase",
      selector: "0x68744619",
    };
  }
  if (selector === "0xd48b6b81" && revertInfo.decodedAgainst !== "helper") {
    return {
      kind: "slippageDuringMint",
      maxRatio: 0n,
      minRatio: 0n,
      newRatio: 0n,
      selector: "0xd48b6b81",
    };
  }

  return null;
}
