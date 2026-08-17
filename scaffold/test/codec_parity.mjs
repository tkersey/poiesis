import { describe, expect, test } from "bun:test";
import { decodeAction, decodeDecisionTurn, encodeAction } from "../runtime/codecs.mjs";

describe("canonical codec rejection", () => {
  test("rejects truncation and malformed UTF-8", () => {
    const read = encodeAction({ action: "read_file", arguments: { path: "a" } });
    expect(() => decodeAction(read.subarray(0, read.length - 1))).toThrow();
    expect(() => decodeAction(Uint8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 0xff))).toThrow(/UTF-8/);
  });

  test("rejects malformed optional, enum, and collection tags", () => {
    const bytes = new Uint8Array(32 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 4 + 1);
    expect(() => decodeDecisionTurn(bytes)).toThrow();
  });

  test("rejects noncanonical Action shape before encoding", () => {
    expect(() => encodeAction({ action: "abort", arguments: "unknown" })).toThrow(/Failure/);
    expect(() => encodeAction({ action: "list_repository", arguments: [], extra: true })).toThrow();
  });
});
