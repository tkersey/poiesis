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
const obstruction = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/result.json", import.meta.url), "utf8"));
const source = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-source.tar.gz")).name];
const runtime = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-runtime.tar.gz")).name];
const artifacts = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-artifacts.tar.gz")).name];

function git(args) {
  const result = Bun.spawnSync(["git", ...args], { cwd: acquired.roots.runner, stdout: "pipe", stderr: "pipe" });
  if (result.error || result.exitCode !== 0) throw new Error(`parent Git verification failed: git ${args.join(" ")}`);
  return Buffer.from(result.stdout);
}

function maximumMachineFuel(definitionBytes, expectedVersion) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(definitionBytes);
  const versions = [...source.matchAll(/\.version = "([0-9]+\.[0-9]+\.[0-9]+)"/g)];
  const fuels = [...source.matchAll(/\.maximum_machine_fuel = ([0-9_]+),/g)];
  assert.equal(versions.length, 1);
  assert.equal(versions[0][1], expectedVersion);
  assert.equal(fuels.length, 1);
  return Number(fuels[0][1].replaceAll("_", ""));
}

assert.equal(obstruction.failed_parent_release, "v1.0.6");
assert.equal(obstruction.successor_parent_release, lock.release.tag);
assert.equal(obstruction.successor_parent_tag_commit, lock.release.tagCommit);
assert.equal(obstruction.successor_parent_definition_sha256, lock.release.definitionSha256);
git(["merge-base", "--is-ancestor", obstruction.failed_parent_tag_commit, lock.release.tagCommit]);
const failedDefinitionBytes = git(["show", `${obstruction.failed_parent_tag_commit}:src/definition.zig`]);
const successorDefinitionBytes = git(["show", `${lock.release.tagCommit}:src/definition.zig`]);
assert.equal(sha256(failedDefinitionBytes), obstruction.failed_parent_definition_sha256);
assert.equal(sha256(successorDefinitionBytes), lock.release.definitionSha256);
const failedMaximumMachineFuel = maximumMachineFuel(failedDefinitionBytes, obstruction.failed_parent_release.slice(1));
const successorMaximumMachineFuel = maximumMachineFuel(successorDefinitionBytes, lock.release.tag.slice(1));
assert.equal(failedMaximumMachineFuel, obstruction.failed_total_machine_fuel);
assert.equal(successorMaximumMachineFuel, obstruction.successor_total_machine_fuel);

const releaseVersion = lock.release.tag.slice(1);
const archivedCandidateBytes = await readFile(join(source, `conformance/praxis-v${releaseVersion}/candidate.json`));
const archivedCandidate = JSON.parse(archivedCandidateBytes);
const standaloneCandidateAsset = lock.assets.find((asset) => asset.name.endsWith("-candidate.json"));
const successorReceiptAsset = lock.assets.find((asset) => asset.name.endsWith("-successor-receipt.json"));
const checksumsAsset = lock.assets.find((asset) => asset.name.endsWith("-checksums.txt"));
assert.ok(standaloneCandidateAsset && successorReceiptAsset && checksumsAsset);
const standaloneCandidateBytes = await readFile(join(acquired.root, "downloads", standaloneCandidateAsset.name));
assert.deepEqual(standaloneCandidateBytes, archivedCandidateBytes);
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
  sourceManifestSha256: lock.release.sourceManifestSha256,
};
assert.equal(archivedCandidate.format, candidate.format);
assert.equal(archivedCandidate.praxisCommit, lock.release.archivedCandidateCommit);
for (const field of ["applicationId", "applicationWasmSha256", "decisionContractDigest", "bindingManifestSha256", "workspaceAdapterSha256", "openaiAdapterSha256", "codecsSha256", "sourceManifestSha256"]) {
  assert.equal(archivedCandidate[field], candidate[field]);
}

const successorReceipt = JSON.parse(await readFile(join(acquired.root, "downloads", successorReceiptAsset.name), "utf8"));
assert.equal(successorReceipt.format, "praxis-successor-artifact-release/v1");
assert.equal(successorReceipt.release, lock.release.tag);
assert.equal(successorReceipt.candidate_commit, archivedCandidate.praxisCommit);
assert.equal(successorReceipt.application_id, candidate.applicationId);
assert.equal(successorReceipt.application_wasm_sha256, candidate.applicationWasmSha256);
assert.equal(successorReceipt.decision_contract_digest, candidate.decisionContractDigest);
assert.equal(successorReceipt.live_execution_claimed, false);
assert.equal(successorReceipt.publication_claimed, false);

const checksums = new Map((await readFile(join(acquired.root, "downloads", checksumsAsset.name), "utf8")).trim().split("\n").map((line) => {
  const match = line.match(/^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/);
  assert.ok(match);
  return [match[2], match[1]];
}));
const checksumAssets = lock.assets.filter((asset) => asset.name !== checksumsAsset.name);
assert.equal(checksums.size, checksumAssets.length);
for (const asset of checksumAssets) assert.equal(checksums.get(asset.name), asset.sha256);

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
process.stdout.write(`failed_parent_definition_sha256=${sha256(failedDefinitionBytes)}\nfailed_parent_maximum_machine_fuel=${failedMaximumMachineFuel}\n`);
process.stdout.write(`parent_definition_sha256=${sha256(successorDefinitionBytes)}\nparent_maximum_machine_fuel=${successorMaximumMachineFuel}\n`);
process.stdout.write("parent_runner_verified=true\n");
