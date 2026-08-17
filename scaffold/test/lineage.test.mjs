import { describe, expect, test } from "bun:test";
import { assertArrow, buildLineage, runFixture } from "../../tools/verify-lineage.mjs";

const digest = "a".repeat(64); const commit = "b".repeat(40);

describe("proof-carrying lineage", () => {
  test("builds the exact parent to child to merged target chain", () => {
    const lineage = buildLineage({ parentCandidateCommit: commit, parentApplicationId: digest, parentWasmSha256: digest, birthGenesisFrameId: digest, birthTerminalFrameId: digest, birthReceiptSha256: digest, scaffoldCommit: commit, generatedDiffSha256: digest, generatedTreeSha256: digest, birthPrNumber: 1, birthPrHead: commit, mergedSourceCommit: commit, candidateSha256: digest, childApplicationId: digest, childWasmSha256: digest, decisionContractDigest: digest, selectionCommit: commit, taskSha256: digest, childGenesisFrameId: digest, childTerminalFrameId: digest, liveReceiptSha256: digest, verifiedDiffSha256: digest, targetRepository: "tkersey/agent", childPrNumber: 2, childPublishedHead: commit, childMergedCommit: commit, birthMergedTreeMatch: true, childMergedTreeMatch: true });
    expect(lineage).toMatchObject({ format: "agent-poiesis-lineage/v1", claims: { parent_byte_frozen: true, child_task_selected_after_freeze: true, manual_target_file_edits: 0 } });
  });

  test("rejects any broken arrow", () => {
    expect(assertArrow("same", "same", "test")).toBe(true);
    expect(() => assertArrow("left", "right", "test")).toThrow();
    expect(runFixture("broken-arrow")).toEqual({ fixture: "broken-arrow", rejected: true });
  });
});
