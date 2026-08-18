import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { birthReceiptFromParent, prepareBirthStore, _birthInternals } from "../../tools/run-birth.mjs";

const candidate = { praxisCommit: "1".repeat(40), applicationId: "a".repeat(64), applicationWasmSha256: "b".repeat(64) };
const parent = {
  praxis_format: 1, mode: "live", candidate_commit: candidate.praxisCommit, application_id: candidate.applicationId,
  application_wasm_sha256: candidate.applicationWasmSha256, repository: "tkersey/poiesis", base_revision: "2".repeat(40),
  policy_sha256: "c".repeat(64), genesis_frame_id: "d".repeat(64), terminal_frame_id: "e".repeat(64), terminal_status: "completed",
  external_effect_count: 20, model_effect_count: 8, non_model_effect_count: 12, test_count: 5, mutation_count: 4,
  unique_changed_file_count: 4, changed_paths: [..._birthInternals.expectedChangedPaths], terminal_file_digests: Object.fromEntries(_birthInternals.expectedChangedPaths.map((path) => [path, "f".repeat(64)])),
  final_diff_sha256: "0".repeat(64), typed_final_result: true, final_check_passed: true, independent_verifier_passed: true,
  fresh_worker_per_step: true, manual_file_edits: 0, unapproved_writes: 0, raw_prompt_recorded: false,
  raw_repository_content_recorded: false, raw_model_output_recorded: false, openai_api_key_recorded: false,
  private_evidence_digest: "3".repeat(64),
};
const context = { scaffoldCommit: parent.base_revision, birthBriefSha256: "4".repeat(64), policyDigest: parent.policy_sha256, parentCandidate: candidate };

describe("controlled birth runner", () => {
  test("projects only bounded parent evidence into the Poiesis birth receipt", () => {
    const receipt = birthReceiptFromParent(parent, context);
    expect(receipt).toMatchObject({ poiesis_format: 1, mode: "birth", parent_release: "v1.0.4", changed_paths: _birthInternals.expectedChangedPaths, full_check_passed: true, hidden_birth_verifier_passed: true });
    expect(JSON.stringify(receipt)).not.toContain("OPENAI_API_KEY");
  });

  test("rejects an incomplete or unauthorized parent result", () => {
    expect(() => birthReceiptFromParent({ ...parent, changed_paths: parent.changed_paths.slice(1) }, context)).toThrow();
    expect(() => birthReceiptFromParent({ ...parent, raw_model_output_recorded: true }, context)).toThrow();
    expect(() => birthReceiptFromParent({ ...parent, manual_file_edits: 1 }, context)).toThrow();
  });

  test("requires the exact operator invocation surface", () => {
    const parsed = _birthInternals.parseArgs(["--repository-root", "/repo", "--base-revision", "0".repeat(40), "--zig", "/zig", "--store", "/store", "--receipt", "receipt.json"]);
    expect(parsed).toMatchObject({ repositoryRoot: "/repo", zigExecutable: "/zig", store: "/store" });
    expect(() => _birthInternals.parseArgs(["--repository-root", "/repo"])).toThrow();
    expect(() => _birthInternals.parseArgs(["--repository-root", "/repo", "--repository-root", "/other", "--base-revision", "0".repeat(40), "--zig", "/zig", "--store", "/store", "--receipt", "receipt.json"])).toThrow();
  });

  test("creates the parent runner store boundary before invocation", async () => {
    const parent = await mkdtemp(join(tmpdir(), "poiesis-birth-test-"));
    const store = join(parent, "store");
    try {
      await prepareBirthStore(store);
      expect((await stat(join(store, "operator-home"))).isDirectory()).toBe(true);
      expect((await stat(join(store, "runs"))).isDirectory()).toBe(true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
