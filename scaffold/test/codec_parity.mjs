import { describe, expect, test } from "bun:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  decodeAction,
  decodeDecisionTurn,
  decodeEffectPayload,
  decodeEffectResult,
  decodeFinalResult,
  decodeInitialGoal,
  decodeObservation,
  encodeAction,
  encodeDecisionTurn,
  encodeEffectPayload,
  encodeEffectResult,
  encodeInitialGoal,
  encodeObservation,
} from "../runtime/codecs.mjs";

const document = JSON.parse(readFileSync(path.resolve("zig-out/release-steward/release-steward.codec-vectors.json"), "utf8"));
assert.equal(document.format, "poiesis-codec-vectors/v1");
assert.ok(Array.isArray(document.vectors));

const repeated = (character) => character.repeat(64);
const entry = (index) => ({ path: `src/file-${index}.zig`, size_bytes: index + 1, writable: index < 4 });
const hit = (index) => ({ path: `src/file-${index}.zig`, line: index + 1, excerpt: "literal match" });
const snapshot = (pathValue, character, contents) => ({ path: pathValue, sha256: repeated(character), contents });
const releaseAssertions = [
  { query: "1.0.0", path_prefix: "build.zig.zon", expectation: "present" },
  { query: "0.9.0", path_prefix: "test/release.zig", expectation: "absent" },
];
const initialGoal = { task: "Reconcile release 1.0.0.", repository: "tkersey/agent", base_revision: "0123456789abcdef0123456789abcdef01234567", current_version: "0.9.0", target_version: "1.0.0", assertions: releaseAssertions };
const replaceRequest = { path: "src/main.zig", expected_sha256: repeated("a"), replacement: "const version = \"1.0.0\";\n", rationale: "Align the release identity." };
const mutation = { path: "src/file-0.zig", old_sha256: repeated("a"), new_sha256: repeated("b"), already_applied: false };
const applied = { path: "src/file-0.zig", old_sha256: repeated("a"), new_sha256: repeated("b"), already_applied: false, current: snapshot("src/file-0.zig", "b", "const version = \"1.0.0\";\n") };
const finalResult = { summary: "Release identities reconciled.", current_version: "0.9.0", target_version: "1.0.0", changed_files: ["src/file-0.zig", "src/file-1.zig"], checks_passed: true, mutation_count: 1, assertions_satisfied: 2 };
const listEmpty = { entries: [], truncated: false };
const listMaximum = { entries: Array.from({ length: 64 }, (_, index) => entry(index)), truncated: true };
const readResult = snapshot("src/main.zig", "b", "const version = \"1.0.0\";\n");
const search = (count, truncated) => ({ assertion_index: 0, query: "1.0.0", path_prefix: "src", hits: Array.from({ length: count }, (_, index) => hit(index)), truncated });
const checkPositive = { exit_code: 0, passed: true, output: "all checks passed", truncated: false };
const checkNegative = { exit_code: -7, passed: false, output: "check failed", truncated: true };
const replaceApplied = { outcome: "applied", value: applied };
const replaceDenied = { outcome: "denied", value: { path: "src/main.zig", reason: "not writable" } };
const replaceConflict = { outcome: "conflict", value: { path: "src/main.zig", expected_sha256: repeated("a"), actual_sha256: repeated("c") } };

const emptyView = {
  current_version: "0.9.0", target_version: "1.0.0", assertions: releaseAssertions, listing: null,
  documents: [], assertion_evidence: [], latest_check: null, latest_replace: null, mutations: [],
  baseline_check_observed: false, latest_check_passed: false, mutation_count: 0,
  last_check_mutation_count: 0, check_count: 0,
};
const populatedView = {
  current_version: "0.9.0", target_version: "1.0.0", assertions: releaseAssertions,
  listing: { entries: [entry(0), entry(1)], truncated: false },
  documents: [snapshot("src/file-0.zig", "b", "const version = \"1.0.0\";\n")],
  assertion_evidence: [
    { assertion_index: 0, satisfied: true, truncated: false, hit_count: 1, observed_mutation_count: 1 },
    { assertion_index: 1, satisfied: true, truncated: false, hit_count: 0, observed_mutation_count: 1 },
  ],
  latest_check: checkPositive,
  latest_replace: replaceApplied,
  mutations: [mutation],
  baseline_check_observed: true, latest_check_passed: true, mutation_count: 1,
  last_check_mutation_count: 1, check_count: 2,
};
const turn = (counters, context) => ({ contract_digest: "ab".repeat(32), goal: initialGoal, counters, phase: "decide", context, strategy_local: null });

const expected = new Map([
  ["initial_goal", initialGoal],
  ["decision_turn_empty", turn({ turns: 0, decisions: 0, effect_actions: 0, child_actions: 0 }, emptyView)],
  ["decision_turn_populated", turn({ turns: 8, decisions: 8, effect_actions: 7, child_actions: 0 }, populatedView)],
  ["action_list", { action: "list_repository", arguments: {} }],
  ["action_read", { action: "read_file", arguments: { path: "src/main.zig" } }],
  ["action_search", { action: "search_assertion", arguments: { assertion_index: 0, query: "1.0.0", path_prefix: "build.zig.zon" } }],
  ["action_check", { action: "run_check", arguments: { suite: "full" } }],
  ["action_replace", { action: "replace_file", arguments: replaceRequest }],
  ["action_final", { action: "final", arguments: finalResult }],
  ["action_abort", { action: "abort", arguments: "authored_abort" }],
  ["final_result", finalResult],
  ["payload_list", {}],
  ["payload_read", { path: "src/main.zig" }],
  ["payload_search", { assertion_index: 0, query: "1.0.0", path_prefix: "build.zig.zon" }],
  ["payload_check", { suite: "full" }],
  ["payload_replace", replaceRequest],
  ["result_list_empty", listEmpty],
  ["result_list_maximum", listMaximum],
  ["result_read", readResult],
  ["result_search_present", search(1, false)],
  ["result_search_absent", search(0, false)],
  ["result_search_truncated", search(24, true)],
  ["result_check_positive", checkPositive],
  ["result_check_negative", checkNegative],
  ["result_replace_applied", replaceApplied],
  ["result_replace_denied", replaceDenied],
  ["result_replace_conflict", replaceConflict],
  ["observation_list", { observation: "list_repository", result: listEmpty }],
  ["observation_read", { observation: "read_file", result: readResult }],
  ["observation_search", { observation: "search_assertion", result: search(1, false) }],
  ["observation_check", { observation: "run_check", result: checkPositive }],
  ["observation_replace", { observation: "replace_file", result: replaceApplied }],
]);

function bytes(vector) {
  assert.match(vector.hex, /^(?:[0-9a-f]{2})*$/);
  return Uint8Array.from(Buffer.from(vector.hex, "hex"));
}

function decode(vector, encoded) {
  if (vector.kind === "initial_goal") return decodeInitialGoal(encoded);
  if (vector.kind === "decision_turn") return decodeDecisionTurn(encoded);
  if (vector.kind === "action") return decodeAction(encoded);
  if (vector.kind === "final_result") return decodeFinalResult(encoded);
  if (vector.kind === "payload") return decodeEffectPayload(vector.operation, encoded);
  if (vector.kind === "result") return decodeEffectResult(vector.operation, encoded);
  if (vector.kind === "observation") return decodeObservation(encoded);
  throw new Error(`unknown vector kind: ${vector.kind}`);
}

function encode(vector, value) {
  if (vector.kind === "initial_goal") return encodeInitialGoal(value);
  if (vector.kind === "decision_turn") return encodeDecisionTurn(value);
  if (vector.kind === "action") return encodeAction(value);
  if (vector.kind === "final_result") return encodeAction({ action: "final", arguments: value }).subarray(4);
  if (vector.kind === "payload") return encodeEffectPayload(vector.operation, value);
  if (vector.kind === "result") return encodeEffectResult(vector.operation, value);
  if (vector.kind === "observation") return encodeObservation(value);
  throw new Error(`unknown vector kind: ${vector.kind}`);
}

describe("Zig and JavaScript canonical codec parity", () => {
  test("matches every positive vector logically and byte-for-byte", () => {
    const seen = new Set();
    for (const vector of document.vectors) {
      expect(seen.has(vector.name)).toBe(false);
      seen.add(vector.name);
      expect(expected.has(vector.name)).toBe(true);
      const encoded = bytes(vector);
      const logical = decode(vector, encoded);
      expect(logical).toEqual(expected.get(vector.name));
      expect(encode(vector, logical)).toEqual(encoded);
    }
    expect(seen).toEqual(new Set(expected.keys()));
  });

  test("rejects malformed bounds, tags, UTF-8, and trailing bytes", () => {
    const read = bytes(document.vectors.find((vector) => vector.name === "action_read"));
    expect(() => decodeAction(read.subarray(0, read.length - 1))).toThrow();
    expect(() => decodeAction(Uint8Array.from([...read, 0]))).toThrow(/trailing/);
    expect(() => decodeAction(Uint8Array.of(255, 255, 255, 255))).toThrow(/unknown Action tag/);
    expect(() => decodeAction(Uint8Array.of(1, 0, 0, 0, 1, 0, 0, 0, 255))).toThrow(/malformed UTF-8/);
    expect(() => decodeAction(Uint8Array.of(3, 0, 0, 0, 1, 0, 0, 0))).toThrow(/invalid CheckSuite ordinal/);
    expect(() => decodeObservation(Uint8Array.of(9, 0, 0, 0))).toThrow(/unknown Observation tag/);
    expect(() => encodeInitialGoal({ ...initialGoal, assertions: Array.from({ length: 9 }, () => releaseAssertions[0]) })).toThrow(/exceeds 8/);
    expect(() => encodeAction({ action: "list_repository", arguments: {}, extra: true })).toThrow(/unknown properties/);
  });
});
