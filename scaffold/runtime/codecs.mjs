const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const failures = [
  "budget_exhausted",
  "arithmetic_overflow",
  "invalid_index",
  "invalid_variant",
  "capacity_exceeded",
  "authored_abort",
];

function exact(value, keys, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has missing or unknown properties`);
  return value;
}

function boundedText(value, maximum, label) {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const bytes = encoder.encode(value);
  if (decoder.decode(bytes) !== value) throw new TypeError(`${label} is not scalar UTF-8`);
  if (bytes.length > maximum) throw new RangeError(`${label} exceeds ${maximum} UTF-8 bytes`);
  return bytes;
}

function boundedArray(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new RangeError(`${label} exceeds ${maximum} items`);
  return value;
}

class Writer {
  #bytes = [];
  u8(value) { if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError("invalid u8"); this.#bytes.push(value); }
  u32(value) { if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) throw new RangeError("invalid u32"); this.#bytes.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255); }
  i32(value) { if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) throw new RangeError("invalid i32"); this.u32(value >>> 0); }
  bool(value) { if (typeof value !== "boolean") throw new TypeError("invalid bool"); this.u8(value ? 1 : 0); }
  text(value, maximum, label) { const bytes = boundedText(value, maximum, label); this.u32(bytes.length); this.#bytes.push(...bytes); }
  bytes(value) { this.#bytes.push(...value); }
  vector(value, maximum, label, emit) { boundedArray(value, maximum, label); this.u32(value.length); for (const item of value) emit(item); }
  optional(value, emit) { if (value === null) this.u8(0); else { this.u8(1); emit(value); } }
  finish() { return Uint8Array.from(this.#bytes); }
}

class Reader {
  #offset = 0;
  constructor(bytes) { if (!(bytes instanceof Uint8Array)) throw new TypeError("codec input must be Uint8Array"); this.bytes = bytes; }
  take(length) { if (this.#offset + length > this.bytes.length) throw new RangeError("truncated codec input"); const out = this.bytes.subarray(this.#offset, this.#offset + length); this.#offset += length; return out; }
  u8() { return this.take(1)[0]; }
  u32() { const b = this.take(4); return (b[0] + b[1] * 0x100 + b[2] * 0x1_0000 + b[3] * 0x100_0000) >>> 0; }
  i32() { return this.u32() | 0; }
  bool() { const value = this.u8(); if (value > 1) throw new RangeError("invalid boolean tag"); return value === 1; }
  text(maximum, label) { const length = this.u32(); if (length > maximum) throw new RangeError(`${label} exceeds ${maximum} UTF-8 bytes`); try { return decoder.decode(this.take(length)); } catch { throw new TypeError(`${label} is malformed UTF-8`); } }
  vector(maximum, label, read) { const length = this.u32(); if (length > maximum) throw new RangeError(`${label} exceeds ${maximum} items`); return Array.from({ length }, read); }
  optional(read) { const tag = this.u8(); if (tag === 0) return null; if (tag === 1) return read(); throw new RangeError("invalid optional tag"); }
  enum(labels, label) { const ordinal = this.u32(); if (ordinal >= labels.length) throw new RangeError(`invalid ${label} ordinal`); return labels[ordinal]; }
  finish() { if (this.#offset !== this.bytes.length) throw new RangeError("trailing codec bytes"); }
}

const hex = (bytes) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
function bytesFromHex(value, count, label) { if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${count * 2}}$`).test(value)) throw new TypeError(`${label} must be lowercase hexadecimal`); return Uint8Array.from({ length: count }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)); }

function encodeAssertion(w, value) { const v = exact(value, ["query", "path_prefix", "expectation"], "ReleaseAssertion"); w.text(v.query, 256, "query"); w.text(v.path_prefix, 256, "path_prefix"); const tag = ["present", "absent"].indexOf(v.expectation); if (tag < 0) throw new RangeError("invalid assertion expectation"); w.u32(tag); }
const decodeAssertion = (r) => ({ query: r.text(256, "query"), path_prefix: r.text(256, "path_prefix"), expectation: r.enum(["present", "absent"], "AssertionExpectation") });
function encodeGoal(w, value) { const v = exact(value, ["task", "repository", "base_revision", "current_version", "target_version", "assertions"], "Goal"); w.text(v.task, 8 * 1024, "task"); w.text(v.repository, 128, "repository"); w.text(v.base_revision, 64, "base_revision"); w.text(v.current_version, 64, "current_version"); w.text(v.target_version, 64, "target_version"); w.vector(v.assertions, 8, "assertions", (item) => encodeAssertion(w, item)); }
const decodeGoal = (r) => ({ task: r.text(8 * 1024, "task"), repository: r.text(128, "repository"), base_revision: r.text(64, "base_revision"), current_version: r.text(64, "current_version"), target_version: r.text(64, "target_version"), assertions: r.vector(8, "assertions", () => decodeAssertion(r)) });

function encodeFileEntry(w, value) { const v = exact(value, ["path", "size_bytes", "writable"], "FileEntry"); w.text(v.path, 256, "path"); w.u32(v.size_bytes); w.bool(v.writable); }
const decodeFileEntry = (r) => ({ path: r.text(256, "path"), size_bytes: r.u32(), writable: r.bool() });
function encodeSnapshot(w, value) { const v = exact(value, ["path", "sha256", "contents"], "DocumentSnapshot"); w.text(v.path, 256, "path"); w.text(v.sha256, 64, "sha256"); w.text(v.contents, 16 * 1024, "contents"); }
const decodeSnapshot = (r) => ({ path: r.text(256, "path"), sha256: r.text(64, "sha256"), contents: r.text(16 * 1024, "contents") });
function encodeSearchHit(w, value) { const v = exact(value, ["path", "line", "excerpt"], "SearchHit"); w.text(v.path, 256, "path"); w.u32(v.line); w.text(v.excerpt, 512, "excerpt"); }
const decodeSearchHit = (r) => ({ path: r.text(256, "path"), line: r.u32(), excerpt: r.text(512, "excerpt") });
function encodeCheckResult(w, value) { const v = exact(value, ["exit_code", "passed", "output", "truncated"], "CheckResult"); w.i32(v.exit_code); w.bool(v.passed); w.text(v.output, 16 * 1024, "output"); w.bool(v.truncated); }
const decodeCheckResult = (r) => ({ exit_code: r.i32(), passed: r.bool(), output: r.text(16 * 1024, "output"), truncated: r.bool() });
function encodeDenied(w, value) { const v = exact(value, ["path", "reason"], "ReplaceDenied"); w.text(v.path, 256, "path"); w.text(v.reason, 512, "reason"); }
const decodeDenied = (r) => ({ path: r.text(256, "path"), reason: r.text(512, "reason") });
function encodeConflict(w, value) { const v = exact(value, ["path", "expected_sha256", "actual_sha256"], "ReplaceConflict"); w.text(v.path, 256, "path"); w.text(v.expected_sha256, 64, "expected_sha256"); w.text(v.actual_sha256, 64, "actual_sha256"); }
const decodeConflict = (r) => ({ path: r.text(256, "path"), expected_sha256: r.text(64, "expected_sha256"), actual_sha256: r.text(64, "actual_sha256") });
function encodeReplaceOutcome(w, value) { const v = exact(value, ["outcome", "value"], "ReplaceOutcome"); if (v.outcome === "applied") { w.u32(0); const a = exact(v.value, ["path", "old_sha256", "new_sha256", "already_applied", "current"], "ReplaceApplied"); w.text(a.path, 256, "path"); w.text(a.old_sha256, 64, "old_sha256"); w.text(a.new_sha256, 64, "new_sha256"); w.bool(a.already_applied); encodeSnapshot(w, a.current); } else if (v.outcome === "denied") { w.u32(1); encodeDenied(w, v.value); } else if (v.outcome === "conflict") { w.u32(2); encodeConflict(w, v.value); } else throw new RangeError("unknown ReplaceOutcome tag"); }
function decodeReplaceOutcome(r) { const tag = r.u32(); if (tag === 0) return { outcome: "applied", value: { path: r.text(256, "path"), old_sha256: r.text(64, "old_sha256"), new_sha256: r.text(64, "new_sha256"), already_applied: r.bool(), current: decodeSnapshot(r) } }; if (tag === 1) return { outcome: "denied", value: decodeDenied(r) }; if (tag === 2) return { outcome: "conflict", value: decodeConflict(r) }; throw new RangeError("unknown ReplaceOutcome tag"); }
function encodeMutation(w, value) { const v = exact(value, ["path", "old_sha256", "new_sha256", "already_applied"], "MutationSummary"); w.text(v.path, 256, "path"); w.text(v.old_sha256, 64, "old_sha256"); w.text(v.new_sha256, 64, "new_sha256"); w.bool(v.already_applied); }
const decodeMutation = (r) => ({ path: r.text(256, "path"), old_sha256: r.text(64, "old_sha256"), new_sha256: r.text(64, "new_sha256"), already_applied: r.bool() });
function encodeEvidence(w, value) { const v = exact(value, ["assertion_index", "satisfied", "truncated", "hit_count", "observed_mutation_count"], "AssertionEvidence"); w.u8(v.assertion_index); w.bool(v.satisfied); w.bool(v.truncated); w.u32(v.hit_count); w.u32(v.observed_mutation_count); }
const decodeEvidence = (r) => ({ assertion_index: r.u8(), satisfied: r.bool(), truncated: r.bool(), hit_count: r.u32(), observed_mutation_count: r.u32() });

const codecs = {
  list: { decode: () => ({}), encodePayload(w, value) { exact(value, [], "list payload"); }, encodeResult(w, value) { const v = exact(value, ["entries", "truncated"], "ListResult"); w.vector(v.entries, 64, "entries", (item) => encodeFileEntry(w, item)); w.bool(v.truncated); }, decodeResult: (r) => ({ entries: r.vector(64, "entries", () => decodeFileEntry(r)), truncated: r.bool() }) },
  read: { decode: (r) => ({ path: r.text(256, "path") }), encodePayload(w, value) { const v = exact(value, ["path"], "read payload"); w.text(v.path, 256, "path"); }, encodeResult: encodeSnapshot, decodeResult: decodeSnapshot },
  search: { decode: (r) => ({ assertion_index: r.u8(), query: r.text(256, "query"), path_prefix: r.text(256, "path_prefix") }), encodePayload(w, value) { const v = exact(value, ["assertion_index", "query", "path_prefix"], "search payload"); w.u8(v.assertion_index); w.text(v.query, 256, "query"); w.text(v.path_prefix, 256, "path_prefix"); }, encodeResult(w, value) { const v = exact(value, ["assertion_index", "query", "path_prefix", "hits", "truncated"], "AssertionSearchResult"); w.u8(v.assertion_index); w.text(v.query, 256, "query"); w.text(v.path_prefix, 256, "path_prefix"); w.vector(v.hits, 24, "hits", (item) => encodeSearchHit(w, item)); w.bool(v.truncated); }, decodeResult: (r) => ({ assertion_index: r.u8(), query: r.text(256, "query"), path_prefix: r.text(256, "path_prefix"), hits: r.vector(24, "hits", () => decodeSearchHit(r)), truncated: r.bool() }) },
  check: { decode: (r) => ({ suite: r.enum(["full"], "CheckSuite") }), encodePayload(w, value) { const v = exact(value, ["suite"], "check payload"); if (v.suite !== "full") throw new RangeError("unknown CheckSuite"); w.u32(0); }, encodeResult: encodeCheckResult, decodeResult: decodeCheckResult },
  replace: { decode: (r) => ({ path: r.text(256, "path"), expected_sha256: r.text(64, "expected_sha256"), replacement: r.text(16 * 1024, "replacement"), rationale: r.text(4 * 1024, "rationale") }), encodePayload(w, value) { const v = exact(value, ["path", "expected_sha256", "replacement", "rationale"], "replace payload"); w.text(v.path, 256, "path"); w.text(v.expected_sha256, 64, "expected_sha256"); w.text(v.replacement, 16 * 1024, "replacement"); w.text(v.rationale, 4 * 1024, "rationale"); }, encodeResult: encodeReplaceOutcome, decodeResult: decodeReplaceOutcome },
};

export function encodeEffectPayload(operation, value) { const codec = codecs[operation]; if (!codec) throw new RangeError("unknown repository operation"); const w = new Writer(); codec.encodePayload(w, value); return w.finish(); }
export function decodeEffectPayload(operation, bytes) { const codec = codecs[operation]; if (!codec) throw new RangeError("unknown repository operation"); const r = new Reader(bytes); const value = codec.decode(r); r.finish(); return value; }
export function encodeEffectResult(operation, value) { const codec = codecs[operation]; if (!codec) throw new RangeError("unknown repository operation"); const w = new Writer(); codec.encodeResult(w, value); return w.finish(); }
export function decodeEffectResult(operation, bytes) { const codec = codecs[operation]; if (!codec) throw new RangeError("unknown repository operation"); const r = new Reader(bytes); const value = codec.decodeResult(r); r.finish(); return value; }

function encodeFinal(w, value) { const v = exact(value, ["summary", "current_version", "target_version", "changed_files", "checks_passed", "mutation_count", "assertions_satisfied"], "ReleaseResult"); w.text(v.summary, 4 * 1024, "summary"); w.text(v.current_version, 64, "current_version"); w.text(v.target_version, 64, "target_version"); w.vector(v.changed_files, 4, "changed_files", (path) => w.text(path, 256, "changed_file")); w.bool(v.checks_passed); w.u32(v.mutation_count); w.u8(v.assertions_satisfied); }
const decodeFinalFrom = (r) => ({ summary: r.text(4 * 1024, "summary"), current_version: r.text(64, "current_version"), target_version: r.text(64, "target_version"), changed_files: r.vector(4, "changed_files", () => r.text(256, "changed_file")), checks_passed: r.bool(), mutation_count: r.u32(), assertions_satisfied: r.u8() });

export function encodeAction(value) { const action = exact(value, ["action", "arguments"], "Action"); const variants = ["list_repository", "read_file", "search_assertion", "run_check", "replace_file", "final", "abort"]; const tag = variants.indexOf(action.action); if (tag < 0) throw new RangeError("unknown action"); const w = new Writer(); w.u32(tag); if (tag === 0) exact(action.arguments, [], "list arguments"); else if (tag === 1) codecs.read.encodePayload(w, action.arguments); else if (tag === 2) codecs.search.encodePayload(w, action.arguments); else if (tag === 3) codecs.check.encodePayload(w, action.arguments); else if (tag === 4) codecs.replace.encodePayload(w, action.arguments); else if (tag === 5) encodeFinal(w, action.arguments); else { const failure = failures.indexOf(action.arguments); if (failure < 0) throw new RangeError("unknown Failure"); w.u32(failure); } return w.finish(); }
export function decodeAction(bytes) { const r = new Reader(bytes); const tag = r.u32(); let value; if (tag === 0) value = { action: "list_repository", arguments: {} }; else if (tag === 1) value = { action: "read_file", arguments: codecs.read.decode(r) }; else if (tag === 2) value = { action: "search_assertion", arguments: codecs.search.decode(r) }; else if (tag === 3) value = { action: "run_check", arguments: codecs.check.decode(r) }; else if (tag === 4) value = { action: "replace_file", arguments: codecs.replace.decode(r) }; else if (tag === 5) value = { action: "final", arguments: decodeFinalFrom(r) }; else if (tag === 6) value = { action: "abort", arguments: r.enum(failures, "Failure") }; else throw new RangeError("unknown Action tag"); r.finish(); return value; }
export function decodeFinalResult(bytes) { const r = new Reader(bytes); const value = decodeFinalFrom(r); r.finish(); return value; }

function encodeList(w, value) { const v = exact(value, ["entries", "truncated"], "ListResult"); w.vector(v.entries, 64, "entries", (item) => encodeFileEntry(w, item)); w.bool(v.truncated); }
const decodeList = (r) => ({ entries: r.vector(64, "entries", () => decodeFileEntry(r)), truncated: r.bool() });
function encodeDecisionView(w, value) { const v = exact(value, ["current_version", "target_version", "assertions", "listing", "documents", "assertion_evidence", "latest_check", "latest_replace", "mutations", "baseline_check_observed", "latest_check_passed", "mutation_count", "last_check_mutation_count", "check_count"], "DecisionView"); w.text(v.current_version, 64, "current_version"); w.text(v.target_version, 64, "target_version"); w.vector(v.assertions, 8, "assertions", (item) => encodeAssertion(w, item)); w.optional(v.listing, (item) => encodeList(w, item)); w.vector(v.documents, 12, "documents", (item) => encodeSnapshot(w, item)); w.vector(v.assertion_evidence, 8, "assertion_evidence", (item) => encodeEvidence(w, item)); w.optional(v.latest_check, (item) => encodeCheckResult(w, item)); w.optional(v.latest_replace, (item) => encodeReplaceOutcome(w, item)); w.vector(v.mutations, 6, "mutations", (item) => encodeMutation(w, item)); w.bool(v.baseline_check_observed); w.bool(v.latest_check_passed); w.u32(v.mutation_count); w.u32(v.last_check_mutation_count); w.u32(v.check_count); }
const decodeDecisionView = (r) => ({ current_version: r.text(64, "current_version"), target_version: r.text(64, "target_version"), assertions: r.vector(8, "assertions", () => decodeAssertion(r)), listing: r.optional(() => decodeList(r)), documents: r.vector(12, "documents", () => decodeSnapshot(r)), assertion_evidence: r.vector(8, "assertion_evidence", () => decodeEvidence(r)), latest_check: r.optional(() => decodeCheckResult(r)), latest_replace: r.optional(() => decodeReplaceOutcome(r)), mutations: r.vector(6, "mutations", () => decodeMutation(r)), baseline_check_observed: r.bool(), latest_check_passed: r.bool(), mutation_count: r.u32(), last_check_mutation_count: r.u32(), check_count: r.u32() });

export function encodeDecisionTurn(value) { const v = exact(value, ["contract_digest", "goal", "counters", "phase", "context", "strategy_local"], "DecisionTurn"); const w = new Writer(); w.bytes(bytesFromHex(v.contract_digest, 32, "contract_digest")); encodeGoal(w, v.goal); const c = exact(v.counters, ["turns", "decisions", "effect_actions", "child_actions"], "Counters"); w.u32(c.turns); w.u32(c.decisions); w.u32(c.effect_actions); w.u32(c.child_actions); const phase = ["decide", "propose", "reflect"].indexOf(v.phase); if (phase < 0) throw new RangeError("unknown DecisionPhase"); w.u32(phase); encodeDecisionView(w, v.context); if (v.strategy_local !== null) throw new TypeError("strategy_local must be null"); return w.finish(); }
export function decodeDecisionTurn(bytes) { const r = new Reader(bytes); const value = { contract_digest: hex(r.take(32)), goal: decodeGoal(r), counters: { turns: r.u32(), decisions: r.u32(), effect_actions: r.u32(), child_actions: r.u32() }, phase: r.enum(["decide", "propose", "reflect"], "DecisionPhase"), context: decodeDecisionView(r), strategy_local: null }; r.finish(); return value; }

export const _codecInternals = { Reader, Writer, exact, boundedText };
