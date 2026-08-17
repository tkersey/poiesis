import { describe, expect, test } from "bun:test";
import { buildCandidate } from "../../tools/freeze-child.mjs";

const digest = "a".repeat(64);

describe("child candidate freeze", () => {
  test("binds every source, artifact, runtime, stack, and lifecycle identity", () => {
    const candidate = buildCandidate({ sourceCommit: "b".repeat(40), sourceTreeSha256: digest, applicationId: digest, applicationWasmSha256: digest, applicationManifestSha256: digest, decisionContractDigest: digest, bindingManifestSha256: digest, codecModuleSha256: digest, workspaceAdapterSha256: digest, openaiAdapterSha256: digest, runtimeManifestSha256: digest, childStackLockSha256: digest, deterministicReceiptSha256: digest, retryReceiptSha256: digest, replayReceiptSha256: digest, measurementReceiptSha256: digest });
    expect(candidate).toMatchObject({ format: "poiesis-child-candidate/v1", source_commit: "b".repeat(40), application_id: digest, measurement_receipt_sha256: digest });
    expect(Object.keys(candidate)).toHaveLength(17);
  });

  test("rejects malformed identities", () => {
    expect(() => buildCandidate({ sourceCommit: "bad", sourceTreeSha256: digest })).toThrow();
  });
});
