import { describe, expect, test } from "bun:test";
import { assertionResult, buildChildVerificationRecord, countEvidence } from "../../tools/verify-child.mjs";

const digest = "a".repeat(64);

describe("independent child verifier", () => {
  test("evaluates present and absent assertions directly", () => {
    const documents = { "build.zig.zon": '.version = "1.0.0";\n', "test/release.zig": "test release\n" };
    expect(assertionResult({ query: "1.0.0", path_prefix: "build.zig.zon", expectation: "present" }, documents)).toMatchObject({ hit_count: 1, satisfied: true });
    expect(assertionResult({ query: "0.9.0", path_prefix: "test", expectation: "absent" }, documents)).toMatchObject({ hit_count: 0, satisfied: true });
  });

  test("reconstructs effect counts from private events", () => {
    const events = [{ interfaceLabel: "model.decide.v1" }, { interfaceLabel: "repo.check.v1" }, { interfaceLabel: "repo.replace.approved.v2", applied: true }];
    const receipt = { external_effect_count: 3, model_effect_count: 1, non_model_effect_count: 2, check_count: 1, mutation_count: 1, unique_changed_file_count: 1, changed_paths: ["build.zig.zon"] };
    expect(countEvidence(receipt, { trace: { events }, changed_paths: receipt.changed_paths })).toEqual({ effects: 3, model: 1, nonModel: 2, checks: 1, mutations: 1 });
    expect(() => countEvidence({ ...receipt, mutation_count: 2 }, { trace: { events }, changed_paths: receipt.changed_paths })).toThrow();
  });

  test("builds only a fully satisfied verification record", () => {
    const record = buildChildVerificationRecord({ candidateSha256: digest, selectionCommit: "b".repeat(40), repository: "tkersey/agent", baseRevision: "c".repeat(40), changedPaths: ["build.zig.zon"], fileDigests: { "build.zig.zon": digest }, diffSha256: digest, targetVersion: "1.0.0", assertions: [{ satisfied: true }], counts: { effects: 1 } });
    expect(record).toMatchObject({ format: "poiesis-child-verification/v1", independent_verification: true, approvals_verified: true });
    expect(() => buildChildVerificationRecord({ ...record, changedPaths: ["build.zig.zon"], fileDigests: { "build.zig.zon": digest }, diffSha256: digest, assertions: [{ satisfied: false }] })).toThrow();
  });
});
