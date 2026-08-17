import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryDefault = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const writableSlots = Object.freeze([
  "src/generated_policy.zig",
  "src/generated_epistemics.zig",
  "src/generated_definition.zig",
  "test/generated_semantics.zig",
]);
const solutionPaths = Object.freeze([
  "fixtures/release-steward-v1/expected",
  "fixtures/release-steward-v1/solution",
  "tools/fixture-model-adapter.mjs",
]);
const selectedTaskPath = "conformance/poiesis-v1/selected-task";
const candidatePath = "conformance/poiesis-v1/child-candidate.json";
const requiredVectorNames = Object.freeze([
  "initial_goal", "decision_turn_empty", "decision_turn_populated",
  "action_list", "action_read", "action_search", "action_check", "action_replace", "action_final", "action_abort", "final_result",
  "payload_list", "payload_read", "payload_search", "payload_check", "payload_replace",
  "result_list_empty", "result_list_maximum", "result_read", "result_search_present", "result_search_absent", "result_search_truncated",
  "result_check_positive", "result_check_negative", "result_replace_applied", "result_replace_denied", "result_replace_conflict",
  "observation_list", "observation_read", "observation_search", "observation_check", "observation_replace",
]);
const decoder = new TextDecoder("utf-8", { fatal: true });
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const options = { repositoryRoot: repositoryDefault, artifacts: null, expect: null, fixture: null };
  for (let index = 0; index < argv.length; index += 2) {
    if (index + 1 >= argv.length) throw new Error("artifact-check arguments must be flag/value pairs");
    const name = argv[index]; const value = argv[index + 1];
    if (name === "--repository-root") options.repositoryRoot = resolve(value);
    else if (name === "--artifacts") options.artifacts = resolve(value);
    else if (name === "--expect" && ["stub", "generated"].includes(value)) options.expect = value;
    else if (name === "--fixture" && ["hidden-solution", "early-task"].includes(value)) options.fixture = value;
    else throw new Error(`unknown artifact-check argument: ${name}`);
  }
  return options;
}

async function pathExists(path) {
  try { await lstat(path); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function regularUtf8(path, maximumBytes) {
  const status = await lstat(path);
  assert.equal(status.isFile(), true, `${path} is not a regular file`);
  assert.equal(status.isSymbolicLink(), false, `${path} is a symbolic link`);
  assert.equal(status.nlink, 1, `${path} is hard linked`);
  assert.ok(status.size <= maximumBytes, `${path} exceeds ${maximumBytes} bytes`);
  const bytes = await readFile(path);
  let text;
  try { text = decoder.decode(bytes); } catch { throw new Error(`${path} is not UTF-8`); }
  assert.equal(text.includes("\0"), false, `${path} contains NUL`);
  return text;
}

function gitTagStrictAncestor(repositoryRoot, tag) {
  const ancestor = Bun.spawnSync(["git", "merge-base", "--is-ancestor", `refs/tags/${tag}`, "HEAD"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (ancestor.exitCode !== 0) return false;
  const tagged = Bun.spawnSync(["git", "rev-parse", `${tag}^{}`], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  const head = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  return tagged.exitCode === 0 && head.exitCode === 0 && Buffer.from(tagged.stdout).toString("utf8").trim() !== Buffer.from(head.stdout).toString("utf8").trim();
}

export function assertChronology({ presentPaths, sourceTagPresent, candidateTagPresent }) {
  const present = new Set(presentPaths);
  if (!sourceTagPresent) {
    for (const path of [...solutionPaths, candidatePath]) assert.equal(present.has(path), false, `${path} exists before child source freeze`);
  }
  if (!candidateTagPresent) assert.equal(present.has(selectedTaskPath), false, `${selectedTaskPath} exists before child candidate freeze`);
}

async function verifyChronology(repositoryRoot) {
  const observed = [];
  for (const path of [...solutionPaths, candidatePath, selectedTaskPath]) if (await pathExists(join(repositoryRoot, path))) observed.push(path);
  assertChronology({
    presentPaths: observed,
    sourceTagPresent: gitTagStrictAncestor(repositoryRoot, "poiesis-v1-child-source"),
    candidateTagPresent: gitTagStrictAncestor(repositoryRoot, "poiesis-v1-child-candidate"),
  });
  return observed;
}

async function verifySemanticSlots(repositoryRoot, expected) {
  const contents = new Map();
  for (const path of writableSlots) contents.set(path, await regularUtf8(join(repositoryRoot, path), 16 * 1024));
  const generatedMatch = contents.get("test/generated_semantics.zig").match(/pub const generated\s*=\s*(true|false)\s*;/);
  assert.ok(generatedMatch, "generated semantics flag is missing");
  const actual = generatedMatch[1] === "true" ? "generated" : "stub";
  if (expected !== null) assert.equal(actual, expected, `expected ${expected} semantic slots`);
  for (const path of writableSlots.slice(0, 3)) {
    const identities = [...contents.get(path).matchAll(/pub const semantic_identity\s*=\s*"([^"]+)"\s*;/g)].map((match) => match[1]);
    assert.equal(identities.length, 1, `${path} must contain exactly one semantic identity`);
    if (actual === "stub") assert.equal(identities[0], "poiesis_stub_v1", `${path} stub identity drifted`);
    else assert.notEqual(identities[0], "poiesis_stub_v1", `${path} retained the stub identity`);
  }
  if (actual === "generated") assert.match(contents.get("src/generated_policy.zig"), /agent\.epistemics\.release-steward\.v1/);
  return actual;
}

function parseManifestText(text) {
  const values = new Map();
  for (const line of text.trimEnd().split("\n")) {
    const separator = line.indexOf("=");
    assert.ok(separator > 0, `malformed manifest line: ${line}`);
    const key = line.slice(0, separator); const value = line.slice(separator + 1);
    assert.equal(values.has(key), false, `duplicate manifest key: ${key}`);
    values.set(key, value);
  }
  return values;
}

function residualEffects(manifest) {
  const count = Number(manifest.get("residual_effect_count"));
  assert.equal(count, 6, "residual effect count mismatch");
  return Array.from({ length: count }, (_, index) => {
    const prefix = `residual_effect.${index}.`;
    return {
      interfaceId: manifest.get(`${prefix}interface_id`),
      payloadSchemaId: manifest.get(`${prefix}payload_schema_id`),
      resultSchemaId: manifest.get(`${prefix}result_schema_id`),
      authorityRequirements: manifest.get(`${prefix}authority_requirements`),
    };
  });
}

function interfaceId(label) {
  return createHash("sha256").update("world.effect-interface.v1").update(Buffer.from([0])).update(label).digest("hex");
}

function readUleb(bytes, cursor) {
  let value = 0; let shift = 0;
  while (true) {
    assert.ok(cursor.offset < bytes.length, "truncated WASM LEB128");
    const byte = bytes[cursor.offset++]; value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return value;
    shift += 7; assert.ok(shift <= 35, "oversized WASM LEB128");
  }
}

function wasmMemoryLimits(bytes) {
  assert.equal(bytes.subarray(0, 4).toString("hex"), "0061736d", "WASM magic mismatch");
  const cursor = { offset: 8 };
  while (cursor.offset < bytes.length) {
    const section = bytes[cursor.offset++]; const length = readUleb(bytes, cursor); const end = cursor.offset + length;
    assert.ok(end <= bytes.length, "truncated WASM section");
    if (section === 5) {
      assert.equal(readUleb(bytes, cursor), 1, "WASM must define exactly one memory");
      const flags = readUleb(bytes, cursor); assert.equal(flags, 1, "WASM memory must have a fixed maximum");
      const minimum = readUleb(bytes, cursor); const maximum = readUleb(bytes, cursor);
      assert.equal(cursor.offset, end, "unexpected WASM memory payload");
      return { minimum, maximum };
    }
    cursor.offset = end;
  }
  throw new Error("WASM memory section is missing");
}

async function verifyArtifacts(repositoryRoot, artifacts) {
  const [bindingBytes, manifestTextBytes, manifestBinary, contractBytes, contractBinary, vectorBytes, wasm] = await Promise.all([
    readFile(join(artifacts, "release-steward.binding-manifest.json")),
    readFile(join(artifacts, "release-steward.manifest.txt")),
    readFile(join(artifacts, "release-steward.manifest.bin")),
    readFile(join(artifacts, "release-steward.decision-contract.json")),
    readFile(join(artifacts, "release-steward.decision-contract.bin")),
    readFile(join(artifacts, "release-steward.codec-vectors.json")),
    readFile(join(artifacts, "release-steward.world.wasm")),
  ]);
  const binding = JSON.parse(bindingBytes); const contract = JSON.parse(contractBytes); const vectors = JSON.parse(vectorBytes);
  const manifest = parseManifestText(decoder.decode(manifestTextBytes)); const residual = residualEffects(manifest);
  assert.equal(manifestBinary.subarray(0, 8).toString("ascii"), "WRLDMNF1", "manifest binary magic mismatch");
  assert.equal(manifest.get("application_name"), "release-steward");
  assert.equal(manifest.get("application_version"), "1.0.0");
  assert.equal(manifest.get("world_application_abi_version"), "1");
  assert.equal(manifest.get("world_package_version"), "3.1.3");
  assert.equal(manifest.get("boundary_static_machine_abi_version"), "2");
  assert.equal(manifest.get("boundary_package_version"), "1.5.0");
  assert.equal(manifest.get("internal_handler_count"), "0");
  assert.equal(binding.format, "poiesis-binding-manifest/v1");
  assert.equal(binding.applicationId, manifest.get("application_id"));
  assert.equal(binding.applicationName, manifest.get("application_name"));
  assert.equal(binding.applicationVersion, manifest.get("application_version"));
  assert.equal(binding.decisionContractDigest, contract.semanticDigest);
  assert.ok(contractBinary.includes(Buffer.from(contract.semanticDigest, "hex")), "binary DecisionContract omits its digest");
  assert.equal(binding.interfaces.length, residual.length);
  const operations = new Set(); let authority = 0n;
  for (const entry of binding.interfaces) {
    assert.equal(operations.has(entry.operation), false, `duplicate binding operation ${entry.operation}`); operations.add(entry.operation);
    assert.equal(interfaceId(entry.interfaceLabel), entry.interfaceId, `interface derivation mismatch for ${entry.operation}`);
    const effect = residual.find((value) => value.interfaceId === entry.interfaceId); assert.ok(effect, `missing residual effect ${entry.operation}`);
    assert.equal(effect.payloadSchemaId, entry.payloadSchemaId); assert.equal(effect.resultSchemaId, entry.resultSchemaId);
    assert.equal(effect.authorityRequirements, entry.authorityRequirements);
    assert.ok(Number.isInteger(entry.maximumResultBytes) && entry.maximumResultBytes > 0 && entry.maximumResultBytes <= 64 * 1024);
    authority |= BigInt(entry.authorityRequirements);
  }
  assert.deepEqual(operations, new Set(["decide", "list", "read", "search", "check", "replace"]));
  assert.equal(authority.toString(), manifest.get("required_host_capabilities"));
  assert.equal(vectors.format, "poiesis-codec-vectors/v1");
  assert.equal(vectors.vectors.length, requiredVectorNames.length, "codec vector count mismatch");
  const vectorNames = new Set();
  for (const entry of vectors.vectors) {
    assert.equal(vectorNames.has(entry.name), false, `duplicate codec vector ${entry.name}`);
    assert.match(entry.hex, /^(?:[0-9a-f]{2})*$/, `noncanonical codec vector ${entry.name}`);
    vectorNames.add(entry.name);
  }
  assert.deepEqual(vectorNames, new Set(requiredVectorNames));
  assert.ok(wasm.length <= 6 * 1024 * 1024, "WASM exceeds six MiB");
  const module = new WebAssembly.Module(wasm);
  assert.equal(WebAssembly.Module.imports(module).length, 0, "WASM has imports");
  assert.ok(WebAssembly.Module.exports(module).some((entry) => entry.kind === "memory"), "WASM does not export memory");
  assert.deepEqual(wasmMemoryLimits(wasm), { minimum: 4096, maximum: 4096 });
  const initialArgs = await lstat(join(repositoryRoot, "zig-out/bin/poiesis-initial-args"));
  assert.equal(initialArgs.isFile(), true, "initial args encoder is missing"); assert.ok((initialArgs.mode & 0o111) !== 0, "initial args encoder is not executable");
  return Object.freeze({ applicationId: binding.applicationId, wasmSha256: sha256(wasm), vectorCount: vectors.vectors.length });
}

export async function verifyCurrent({ repositoryRoot = repositoryDefault, artifacts = null, expect = null } = {}) {
  const root = resolve(repositoryRoot); const artifactRoot = artifacts ? resolve(artifacts) : join(root, "zig-out/release-steward");
  const [semanticState, observedPaths, artifactState] = await Promise.all([
    verifySemanticSlots(root, expect),
    verifyChronology(root),
    verifyArtifacts(root, artifactRoot),
  ]);
  return Object.freeze({ semanticState, observedPaths, ...artifactState });
}

export function runFixture(name) {
  const input = name === "hidden-solution"
    ? { presentPaths: [solutionPaths[0]], sourceTagPresent: false, candidateTagPresent: false }
    : { presentPaths: [selectedTaskPath], sourceTagPresent: true, candidateTagPresent: false };
  assert.throws(() => assertChronology(input));
  return Object.freeze({ fixture: name, rejected: true });
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.fixture ? runFixture(options.fixture) : await verifyCurrent(options);
  process.stdout.write(`${JSON.stringify({ format: "poiesis-artifact-check/v1", ...result })}\n`);
}
