import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { acquireParent } from "./acquire-parent.mjs";

for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_REPLACE_REF_BASE"]) delete process.env[name];
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CONFIG_GLOBAL = "/dev/null";
process.env.GIT_NO_REPLACE_OBJECTS = "1";
process.env.GIT_TERMINAL_PROMPT = "0";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lock = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/parent.lock.json", import.meta.url), "utf8"));
const child = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/child-stack.lock.json", import.meta.url), "utf8"));
const acquired = await acquireParent({ root: resolve(".poiesis/parent") });
const source = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-source.tar.gz")).name];
const runtime = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-runtime.tar.gz")).name];
const artifacts = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-artifacts.tar.gz")).name];

const archivedCandidate = JSON.parse(await readFile(join(source, "conformance/praxis-v1.0.5/candidate.json"), "utf8"));
const candidate = {
  format: "praxis-candidate/v1",
  praxisCommit: lock.release.candidateCommit,
  applicationId: lock.release.applicationId,
  applicationWasmSha256: lock.release.applicationWasmSha256,
  decisionContractDigest: lock.release.decisionContractDigest,
  bindingManifestSha256: lock.release.bindingManifestSha256,
  workspaceAdapterSha256: lock.release.workspaceAdapterSha256,
  openaiAdapterSha256: lock.release.openaiAdapterSha256,
  codecsSha256: lock.release.codecsSha256,
};
assert.equal(archivedCandidate.format, candidate.format);
assert.match(archivedCandidate.praxisCommit, /^[0-9a-f]{40}$/);
for (const field of ["applicationId", "applicationWasmSha256", "decisionContractDigest", "bindingManifestSha256", "workspaceAdapterSha256", "openaiAdapterSha256", "codecsSha256"]) {
  assert.equal(archivedCandidate[field], candidate[field]);
}

const runtimeFiles = {
  workspaceAdapterSha256: "runtime/workspace-adapter.mjs",
  openaiAdapterSha256: "runtime/openai-adapter.mjs",
  codecsSha256: "runtime/codecs.mjs",
};
for (const [field, file] of Object.entries(runtimeFiles)) assert.equal(sha256(await readFile(join(runtime, file))), candidate[field]);

const artifactRoot = join(artifacts, "zig-out/repository-steward");
const wasm = await readFile(join(artifactRoot, "repository-steward.world.wasm"));
assert.equal(sha256(wasm), lock.release.applicationWasmSha256);
assert.equal(WebAssembly.Module.imports(new WebAssembly.Module(wasm)).length, 0);
const bindingBytes = await readFile(join(artifactRoot, "repository-steward.binding-manifest.json"));
assert.equal(sha256(bindingBytes), lock.release.bindingManifestSha256);
const binding = JSON.parse(bindingBytes); assert.equal(binding.applicationId, lock.release.applicationId); assert.equal(binding.decisionContractDigest, lock.release.decisionContractDigest);
const contract = JSON.parse(await readFile(join(artifactRoot, "repository-steward.decision-contract.json"), "utf8"));
assert.equal(contract.semanticDigest, lock.release.decisionContractDigest);

for (const [name, expected] of Object.entries(lock.lifecycleReceipts)) {
  const file = name === "measure" ? "measure.json" : `${name}.json`;
  assert.equal(sha256(await readFile(join(artifacts, "conformance/praxis-v1/receipts", file))), expected);
}

const reference = JSON.parse(await readFile(join(runtime, "conformance/praxis-v1/reference-stack.lock.json"), "utf8"));
const referenceBytes = await readFile(join(runtime, "conformance/praxis-v1/reference-stack.lock.json"));
const referenceStackLockSha256 = sha256(referenceBytes);
assert.equal(archivedCandidate.referenceStackLockSha256, referenceStackLockSha256);
assert.deepEqual(reference.tuple, lock.tuple);
for (const name of ["worldHost", "worldCapabilities"]) {
  assert.equal(reference.archives[name].url, child.archives[name].url);
  assert.equal(reference.archives[name].sha256, child.archives[name].sha256);
  assert.equal(reference.archives[name].root, child.archives[name].root);
}
assert.ok(acquired.roots.worldHost.endsWith(child.archives.worldHost.root));
assert.ok(acquired.roots.worldCapabilities.endsWith(child.archives.worldCapabilities.root));

const releaseCandidate = {
  ...candidate,
  referenceStackLockSha256,
  deterministicReceiptSha256: lock.lifecycleReceipts.deterministic,
  retryReceiptSha256: lock.lifecycleReceipts.retry,
  replayReceiptSha256: lock.lifecycleReceipts.replay,
  measureReceiptSha256: lock.lifecycleReceipts.measure,
};
const releaseCandidateBytes = Buffer.from(`${JSON.stringify(releaseCandidate, null, 2)}\n`);
assert.equal(sha256(await readFile(acquired.roots.candidate)), sha256(releaseCandidateBytes));
const runnerCandidate = await import(pathToFileURL(join(acquired.roots.runner, "tools/candidate.mjs")).href);
const verifiedRunnerCandidate = await runnerCandidate.verifyCandidate(acquired.roots.candidate);
assert.deepEqual(verifiedRunnerCandidate, releaseCandidate);

const zig = Bun.spawnSync(["zig", "version"], { stdout: "pipe", stderr: "pipe" });
assert.equal(zig.exitCode, 0); assert.equal(new TextDecoder().decode(zig.stdout).trim(), "0.16.0");
process.stdout.write(`parent_candidate_commit=${candidate.praxisCommit}\n`);
process.stdout.write(`parent_archived_candidate_commit=${archivedCandidate.praxisCommit}\n`);
process.stdout.write(`parent_candidate_json_sha256=${sha256(releaseCandidateBytes)}\n`);
process.stdout.write(`parent_application_id=${candidate.applicationId}\nparent_wasm_sha256=${candidate.applicationWasmSha256}\nparent_verified=true\n`);
process.stdout.write("parent_runner_verified=true\n");
