import { describe, expect, test } from "bun:test";
import {
  decodeAction,
  decodeDecisionTurn,
  decodeEffectPayload,
  decodeEffectResult,
  decodeFinalResult,
  encodeAction,
  encodeDecisionTurn,
  encodeEffectPayload,
  encodeEffectResult,
} from "../runtime/codecs.mjs";

const digest = "a".repeat(64);
const otherDigest = "b".repeat(64);
const snapshot = { path: "src/main.zig", sha256: digest, contents: "const ready = true;\n" };
const assertion = { query: "1.0.0", path_prefix: "build.zig.zon", expectation: "present" };

const actions = [
  { action: "list_repository", arguments: {} },
  { action: "read_file", arguments: { path: "src/main.zig" } },
  { action: "search_assertion", arguments: { assertion_index: 0, query: "1.0.0", path_prefix: "build.zig.zon" } },
  { action: "run_check", arguments: { suite: "full" } },
  { action: "replace_file", arguments: { path: "src/main.zig", expected_sha256: digest, replacement: snapshot.contents, rationale: "Align release." } },
  { action: "final", arguments: { summary: "Aligned release.", current_version: "0.9.0", target_version: "1.0.0", changed_files: ["src/main.zig"], checks_passed: true, mutation_count: 1, assertions_satisfied: 1 } },
  { action: "abort", arguments: "authored_abort" },
];

describe("Release Steward action codec", () => {
  for (const value of actions) test(`round trips ${value.action}`, () => {
    expect(decodeAction(encodeAction(value))).toEqual(value);
  });

  test("rejects unknown fields, tags, suites, bounds, and trailing bytes", () => {
    expect(() => encodeAction({ action: "read_file", arguments: { path: "x", extra: true } })).toThrow();
    expect(() => encodeAction({ action: "run_check", arguments: { suite: "quick" } })).toThrow();
    expect(() => encodeAction({ action: "read_file", arguments: { path: "x".repeat(257) } })).toThrow();
    expect(() => decodeAction(Uint8Array.of(99, 0, 0, 0))).toThrow();
    expect(() => decodeAction(Uint8Array.from([...encodeAction(actions[1]), 0]))).toThrow();
  });
});

describe("Release Steward effect codecs", () => {
  const cases = [
    ["list", {}, { entries: [{ path: "src/main.zig", size_bytes: 20, writable: true }], truncated: false }],
    ["read", { path: "src/main.zig" }, snapshot],
    ["search", { assertion_index: 0, query: "1.0.0", path_prefix: "build.zig.zon" }, { assertion_index: 0, query: "1.0.0", path_prefix: "build.zig.zon", hits: [{ path: "build.zig.zon", line: 3, excerpt: ".version = \"1.0.0\"" }], truncated: false }],
    ["check", { suite: "full" }, { exit_code: 0, passed: true, output: "pass", truncated: false }],
    ["replace", { path: "src/main.zig", expected_sha256: digest, replacement: snapshot.contents, rationale: "align" }, { outcome: "applied", value: { path: "src/main.zig", old_sha256: digest, new_sha256: otherDigest, already_applied: false, current: { ...snapshot, sha256: otherDigest } } }],
  ];
  for (const [operation, payload, result] of cases) test(`round trips ${operation}`, () => {
    expect(decodeEffectPayload(operation, encodeEffectPayload(operation, payload))).toEqual(payload);
    expect(decodeEffectResult(operation, encodeEffectResult(operation, result))).toEqual(result);
  });

  test("decodes the terminal result independently", () => {
    const value = actions[5].arguments;
    expect(decodeFinalResult(encodeAction(actions[5]).subarray(4))).toEqual(value);
  });
});

test("DecisionTurn round trips the exact Goal and empty working set", () => {
  const turn = {
    contract_digest: digest,
    goal: { task: "Release 1.0.0", repository: "tkersey/agent", base_revision: "0".repeat(40), current_version: "0.9.0", target_version: "1.0.0", assertions: [assertion] },
    counters: { turns: 1, decisions: 1, effect_actions: 0, child_actions: 0 },
    phase: "decide",
    context: {
      current_version: "0.9.0", target_version: "1.0.0", assertions: [assertion], listing: null,
      documents: [], assertion_evidence: [], latest_check: null, latest_replace: null, mutations: [],
      baseline_check_observed: false, latest_check_passed: false, mutation_count: 0,
      last_check_mutation_count: 0, check_count: 0,
    },
    strategy_local: null,
  };
  expect(decodeDecisionTurn(encodeDecisionTurn(turn))).toEqual(turn);
});
