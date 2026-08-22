import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const obstruction = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/result.json", import.meta.url), "utf8"));
const failedReceiptBytes = await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/reproducer/birth.live.redacted.json", import.meta.url));
const failedReceipt = JSON.parse(failedReceiptBytes);
const approvalProjectionBytes = await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/reproducer/approvals.redacted.json", import.meta.url));
const approvalProjection = JSON.parse(approvalProjectionBytes);
const terminalFiles = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/reproducer/terminal-files.redacted.json", import.meta.url), "utf8"));
const terminalFrameHex = (await readFile(new URL("../conformance/poiesis-v1/obstructions/release-steward-birth-v106-machine-fuel/reproducer/terminal-frame.hex", import.meta.url), "utf8")).trim();
const source = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-source.tar.gz")).name];
const runtime = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-runtime.tar.gz")).name];
const artifacts = acquired.roots[lock.assets.find((asset) => asset.name.endsWith("-artifacts.tar.gz")).name];
const worldHost = await import(pathToFileURL(join(acquired.roots.worldHost, "src/v1/index.mjs")).href);
const parentCorrection = JSON.parse(await readFile(join(source, "conformance/praxis-v1.0.7/obstructions/poiesis-r13-machine-fuel/result.json"), "utf8"));
assert.equal(obstruction.format, "poiesis-obstruction/v1");
assert.equal(parentCorrection.format, "praxis-obstruction-correction/v1");
assert.deepEqual(Object.keys(obstruction).sort(), [
  "application_abi", "applied_replacements", "effect_count", "effect_protocol",
  "failed_live_receipt_sha256", "failed_parent_definition_sha256", "failed_parent_release",
  "failed_parent_tag_commit", "failed_scaffold_commit", "failed_terminal_frame_id",
  "failed_terminal_frame_block_sha256",
  "failed_total_machine_fuel", "failure", "format", "frame", "generated_epistemics_bytes",
  "machine_abi", "machine_state", "maximum_changed_files", "maximum_decisions",
  "maximum_effect_actions", "maximum_mutation_operations", "model_authored_abort", "owner",
  "successor_parent_definition_sha256", "successor_parent_release",
  "successor_parent_tag_commit", "successor_total_machine_fuel",
].sort());
assert.deepEqual(Object.keys(parentCorrection).sort(), [
  "application_abi", "effect_protocol", "failed_receipt_sha256", "failed_release",
  "failed_scaffold_commit", "failed_terminal_failure", "failed_terminal_frame_id",
  "failed_total_machine_fuel", "failure_applied_replacements", "failure_external_effect_count",
  "failure_generated_epistemics_bytes", "failure_model_authored_abort", "format", "frame",
  "machine_abi", "machine_state", "maximum_changed_files", "maximum_decisions",
  "maximum_effect_actions", "maximum_mutation_operations", "owner", "successor_total_machine_fuel",
].sort());
assert.deepEqual(Object.keys(failedReceipt).sort(), [
  "application_id", "base_revision", "candidate_commit", "external_effect_count",
  "failure_class", "mode", "openai_api_key_recorded", "ordered_interfaces",
  "praxis_format", "raw_model_output_recorded", "raw_prompt_recorded",
  "raw_repository_content_recorded", "repository", "run_id_sha256", "terminal_status",
].sort());
assert.equal(sha256(failedReceiptBytes), obstruction.failed_live_receipt_sha256);
assert.equal(failedReceipt.praxis_format, 1);
assert.equal(failedReceipt.mode, "live-failure");
assert.equal(failedReceipt.candidate_commit, lock.predecessorRelease.tagCommit);
const predecessorCandidate = JSON.parse(git(["show", `${lock.predecessorRelease.tag}:conformance/praxis-v1.0.6/candidate.json`]));
assert.equal(predecessorCandidate.format, "praxis-candidate/v1");
assert.equal(predecessorCandidate.applicationId, lock.predecessorRelease.applicationId);
assert.equal(failedReceipt.application_id, lock.predecessorRelease.applicationId);
assert.equal(failedReceipt.repository, "tkersey/poiesis");
assert.equal(failedReceipt.base_revision, obstruction.failed_scaffold_commit);
assert.equal(failedReceipt.terminal_status, 2);
assert.equal(failedReceipt.external_effect_count, obstruction.effect_count);
assert.equal(failedReceipt.ordered_interfaces.length, obstruction.effect_count);
assert.deepEqual(Object.keys(approvalProjection).sort(), ["approvals", "format", "run_id_sha256"]);
assert.equal(approvalProjection.format, "poiesis-approval-projection/v1");
assert.equal(approvalProjection.run_id_sha256, failedReceipt.run_id_sha256);
const approvals = approvalProjection.approvals;
assert.equal(approvals.length, obstruction.applied_replacements);
for (const approval of approvals) {
  assert.deepEqual(Object.keys(approval).sort(), [
    "applicationId", "approved", "expectedSha256", "format", "mode", "path",
    "policyDigest", "proposalDigest", "replacementSha256", "requestId", "sourceSha256",
  ].sort());
  assert.equal(approval.format, "praxis-approval/v1");
  assert.equal(approval.applicationId, lock.predecessorRelease.applicationId);
  assert.equal(approval.approved, true);
  assert.equal(approval.mode, "receiver-policy-verified");
  for (const field of ["policyDigest", "proposalDigest", "expectedSha256", "replacementSha256", "requestId", "sourceSha256"]) assert.match(approval[field], /^[0-9a-f]{64}$/);
}
assert.equal(new Set(approvals.map((approval) => approval.requestId)).size, approvals.length);
assert.equal(new Set(approvals.map((approval) => approval.proposalDigest)).size, approvals.length);
const failedScaffoldEvidenceCommit = "b15281ff26c585752856694c48a73eab669e72c7";
assert.equal(poiesisGit(["rev-parse", `${failedScaffoldEvidenceCommit}^`]).toString("utf8").trim(), obstruction.failed_scaffold_commit);
const failedScaffoldLock = JSON.parse(poiesisGit(["show", `${failedScaffoldEvidenceCommit}:conformance/poiesis-v1/scaffold.lock.json`]));
assert.equal(failedScaffoldLock.baselineTag, "poiesis-v1-scaffold-r13");
assert.equal(failedScaffoldLock.baselineCommit, obstruction.failed_scaffold_commit);
assert.equal(new Set(approvals.map((approval) => approval.policyDigest)).size, 1);
assert.equal(approvals[0].policyDigest, failedScaffoldLock.birthPolicySha256);
assert.equal(failedReceipt.ordered_interfaces.filter((name) => name === "repo.replace.approved.v2").length, approvals.length);
assert.equal(terminalFiles.format, "poiesis-terminal-files-projection/v1");
assert.deepEqual(Object.keys(terminalFiles).sort(), ["files", "format"]);
assert.equal(terminalFiles.files.length, 2);
for (const path of new Set(approvals.map((approval) => approval.path))) {
  const pathApprovals = approvals.filter((approval) => approval.path === path);
  const baselineDigest = sha256(poiesisGit(["show", `poiesis-v1-scaffold-r13:${path}`]));
  const terminal = terminalFiles.files.find((file) => file.path === path);
  assert.ok(terminal);
  assert.deepEqual(Object.keys(terminal).sort(), ["path", "sha256", "size_bytes"]);
  assert.match(terminal.sha256, /^[0-9a-f]{64}$/);
  assert.ok(Number.isSafeInteger(terminal.size_bytes) && terminal.size_bytes > 0 && terminal.size_bytes <= 16 * 1024);
  assert.equal(terminalDigests(baselineDigest, pathApprovals).has(terminal.sha256), true, `approval chain is discontinuous: ${path}`);
}
assert.equal(terminalFiles.files.find((file) => file.path === "src/generated_epistemics.zig").size_bytes, obstruction.generated_epistemics_bytes);
assert.equal(failedReceipt.ordered_interfaces.at(-1), "repo.replace.approved.v2");
assert.match(terminalFrameHex, /^[0-9a-f]+$/);
assert.equal(terminalFrameHex.length % 2, 0);
const terminalFrameBytes = Buffer.from(terminalFrameHex, "hex");
assert.equal(sha256(terminalFrameBytes), obstruction.failed_terminal_frame_block_sha256);
const terminalFrame = worldHost.decodeFrame(terminalFrameBytes);
assert.equal(Buffer.from(terminalFrame.frameId).toString("hex"), obstruction.failed_terminal_frame_id);
assert.equal(Buffer.from(terminalFrame.applicationId).toString("hex"), lock.predecessorRelease.applicationId);
assert.equal(terminalFrame.sequence, BigInt(obstruction.effect_count));
assert.equal(terminalFrame.status, worldHost.FrameStatus.failed);
assert.equal(new TextDecoder("utf-8", { fatal: true }).decode(terminalFrame.failure), obstruction.failure);
for (const field of ["raw_prompt_recorded", "raw_repository_content_recorded", "raw_model_output_recorded", "openai_api_key_recorded"]) assert.equal(failedReceipt[field], false);

function git(args) {
  const result = Bun.spawnSync(["git", ...args], { cwd: acquired.roots.runner, stdout: "pipe", stderr: "pipe" });
  if (result.error || result.exitCode !== 0) throw new Error(`parent Git verification failed: git ${args.join(" ")}`);
  return Buffer.from(result.stdout);
}

function poiesisGit(args) {
  const result = Bun.spawnSync(["git", ...args], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (result.error || result.exitCode !== 0) throw new Error(`Poiesis Git verification failed: git ${args.join(" ")}`);
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

function terminalDigests(currentDigest, approvals, used = new Set()) {
  if (used.size === approvals.length) return new Set([currentDigest]);
  const results = new Set();
  for (let index = 0; index < approvals.length; index += 1) {
    if (used.has(index) || approvals[index].expectedSha256 !== currentDigest) continue;
    const next = new Set(used); next.add(index);
    for (const digest of terminalDigests(approvals[index].replacementSha256, approvals, next)) results.add(digest);
  }
  return results;
}

assert.equal(obstruction.failed_parent_release, lock.predecessorRelease.tag);
assert.equal(poiesisGit(["rev-parse", "poiesis-v1-scaffold-r13^{commit}"]).toString("utf8").trim(), obstruction.failed_scaffold_commit);
assert.equal(obstruction.failed_parent_tag_commit, lock.predecessorRelease.tagCommit);
assert.equal(obstruction.successor_parent_release, lock.release.tag);
assert.equal(obstruction.successor_parent_tag_commit, lock.release.tagCommit);
assert.equal(obstruction.successor_parent_definition_sha256, lock.release.definitionSha256);
assert.equal(git(["rev-parse", `${lock.predecessorRelease.tag}^{commit}`]).toString("utf8").trim(), lock.predecessorRelease.tagCommit);
assert.equal(git(["rev-parse", `${lock.release.tag}^{commit}`]).toString("utf8").trim(), lock.release.tagCommit);
git(["merge-base", "--is-ancestor", lock.predecessorRelease.tagCommit, lock.release.tagCommit]);
const failedDefinitionBytes = git(["show", `${obstruction.failed_parent_tag_commit}:src/definition.zig`]);
const successorDefinitionBytes = git(["show", `${lock.release.tagCommit}:src/definition.zig`]);
assert.equal(sha256(failedDefinitionBytes), obstruction.failed_parent_definition_sha256);
assert.equal(sha256(successorDefinitionBytes), lock.release.definitionSha256);
const failedMaximumMachineFuel = maximumMachineFuel(failedDefinitionBytes, obstruction.failed_parent_release.slice(1));
const successorMaximumMachineFuel = maximumMachineFuel(successorDefinitionBytes, lock.release.tag.slice(1));
assert.equal(failedMaximumMachineFuel, obstruction.failed_total_machine_fuel);
assert.equal(successorMaximumMachineFuel, obstruction.successor_total_machine_fuel);
assert.deepEqual({
  owner: obstruction.owner,
  failed_release: obstruction.failed_parent_release,
  failed_scaffold_commit: obstruction.failed_scaffold_commit,
  failed_receipt_sha256: obstruction.failed_live_receipt_sha256,
  failed_terminal_frame_id: obstruction.failed_terminal_frame_id,
  failed_terminal_failure: obstruction.failure,
  failed_total_machine_fuel: obstruction.failed_total_machine_fuel,
  successor_total_machine_fuel: obstruction.successor_total_machine_fuel,
  failure_external_effect_count: obstruction.effect_count,
  failure_applied_replacements: obstruction.applied_replacements,
  failure_generated_epistemics_bytes: obstruction.generated_epistemics_bytes,
  failure_model_authored_abort: obstruction.model_authored_abort,
  maximum_decisions: obstruction.maximum_decisions,
  maximum_effect_actions: obstruction.maximum_effect_actions,
  maximum_mutation_operations: obstruction.maximum_mutation_operations,
  maximum_changed_files: obstruction.maximum_changed_files,
  machine_abi: obstruction.machine_abi,
  machine_state: obstruction.machine_state,
  application_abi: obstruction.application_abi,
  frame: obstruction.frame,
  effect_protocol: obstruction.effect_protocol,
}, {
  owner: parentCorrection.owner,
  failed_release: parentCorrection.failed_release,
  failed_scaffold_commit: parentCorrection.failed_scaffold_commit,
  failed_receipt_sha256: parentCorrection.failed_receipt_sha256,
  failed_terminal_frame_id: parentCorrection.failed_terminal_frame_id,
  failed_terminal_failure: parentCorrection.failed_terminal_failure,
  failed_total_machine_fuel: parentCorrection.failed_total_machine_fuel,
  successor_total_machine_fuel: parentCorrection.successor_total_machine_fuel,
  failure_external_effect_count: parentCorrection.failure_external_effect_count,
  failure_applied_replacements: parentCorrection.failure_applied_replacements,
  failure_generated_epistemics_bytes: parentCorrection.failure_generated_epistemics_bytes,
  failure_model_authored_abort: parentCorrection.failure_model_authored_abort,
  maximum_decisions: parentCorrection.maximum_decisions,
  maximum_effect_actions: parentCorrection.maximum_effect_actions,
  maximum_mutation_operations: parentCorrection.maximum_mutation_operations,
  maximum_changed_files: parentCorrection.maximum_changed_files,
  machine_abi: parentCorrection.machine_abi,
  machine_state: parentCorrection.machine_state,
  application_abi: parentCorrection.application_abi,
  frame: parentCorrection.frame,
  effect_protocol: parentCorrection.effect_protocol,
});

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
