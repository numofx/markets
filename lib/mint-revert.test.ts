// @ts-nocheck
import { describe, expect, it } from "bun:test";
import { encodeErrorResult } from "viem";
import { poolAbi } from "@/lib/abi/pool";
import { decodeMintErrorHint, getRevertInfo } from "@/lib/mint-revert";

const POOL = "0x483D89802E0B780C03D1647C98031694f2fD743D";
const HELPER = "0x9f1f2ebea83b81b9ad9a3d58397a165ca4f0096c";

describe("getRevertInfo", () => {
  it("decodes pool full-data revert for NotEnoughBaseIn", () => {
    const data = encodeErrorResult({
      abi: poolAbi,
      args: [1n, 2n],
      errorName: "NotEnoughBaseIn",
    });
    const caught = { data };

    const info = getRevertInfo(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });

    expect(info.selector).toBe("0x68744619");
    expect(info.data).toBe(data);
    expect(info.decodedAgainst).toBe("pool");
    expect(info.decodedErrorName).toBe("NotEnoughBaseIn");
    expect(info.decodedArgs).toEqual([1n, 2n]);
  });

  it("handles pool selector-only fallback", () => {
    const caught = {
      message: `The contract function "mintTwoSided" reverted with signature 0x68744619 address: ${POOL}`,
    };

    const info = getRevertInfo(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });
    const hint = decodeMintErrorHint(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });

    expect(info.selector).toBe("0x68744619");
    expect(info.data).toBeNull();
    expect(info.decodedAgainst).toBe("pool");
    expect(hint?.kind).toBe("notEnoughBase");
  });

  it("does not label helper selector-only revert as NotEnoughBaseIn", () => {
    const caught = {
      message: `The contract function "mintTwoSided" reverted with signature 0x68744619 address: ${HELPER}`,
    };

    const info = getRevertInfo(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });
    const hint = decodeMintErrorHint(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });

    expect(info.selector).toBe("0x68744619");
    expect(info.decodedAgainst).toBe("helper");
    expect(hint).toBeNull();
  });

  it("reads nested cause.data shape", () => {
    const data = encodeErrorResult({
      abi: poolAbi,
      args: [3n, 7n],
      errorName: "NotEnoughBaseIn",
    });
    const caught = { cause: { cause: { data } } };

    const info = getRevertInfo(caught, {
      helperAddress: HELPER,
      poolAddress: POOL,
    });

    expect(info.selector).toBe("0x68744619");
    expect(info.data).toBe(data);
    expect(info.decodedErrorName).toBe("NotEnoughBaseIn");
  });

  it("returns null selector/data when nothing is present", () => {
    const info = getRevertInfo({ message: "execution reverted" }, { poolAddress: POOL });
    const hint = decodeMintErrorHint({ message: "execution reverted" }, { poolAddress: POOL });

    expect(info.selector).toBeNull();
    expect(info.data).toBeNull();
    expect(info.decodedAgainst).toBe("unknown");
    expect(hint).toBeNull();
  });
});
