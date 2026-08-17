import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as workspaceAdapter from "../scaffold/runtime/workspace-adapter.mjs";
import { decodeEffectPayload } from "../scaffold/runtime/codecs.mjs";

const allowedRepositories = new Set(["tkersey/boundary", "tkersey/world", "tkersey/agent", "tkersey/praxis"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });

function parseArgs(argv) {
  const names = { "--poiesis-root": "poiesisRoot", "--repository-root": "targetRoot", "--repository": "repository", "--base-revision": "baseRevision", "--task": "task", "--goal": "goal", "--policy": "policy", "--candidate": "candidate", "--store": "store", "--receipt": "receipt", "--zig": "zigExecutable" };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!names[flag] || !value || values[names[flag]] !== undefined) throw new Error(`invalid child verification option: ${String(flag)}`); values[names[flag]] = value; }
  for (const name of Object.values(names)) if (!values[name]) throw new Error(`${name} is required`);
  for (const name of ["poiesisRoot", "targetRoot", "task", "goal", "policy", "candidate", "store", "zigExecutable"]) if (!isAbsolute(values[name])) throw new Error(`${name} must be absolute`);
  if (!allowedRepositories.has(values.repository) || !/^[0-9a-f]{40}$/.test(values.baseRevision)) throw new Error("target identity is outside the v1 profile");
  for (const name of ["poiesisRoot", "targetRoot", "task", "goal", "policy", "candidate", "store", "receipt", "zigExecutable"]) values[name] = resolve(values[name]);
  return Object.freeze(values);
}

function command(executable, args, options = {}) {
  const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" }); const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0);
  if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`);
  return Object.freeze({ status: result.exitCode, stdout, stderr });
}

async function json(path, maximum = 16 * 1024 * 1024) { const status = await lstat(path); assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= maximum); return JSON.parse(utf8.decode(await readFile(path))); }
function inside(parent, child) { const path = relative(parent, child); return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)); }
function fixedEnvironment(home, zig) { return { HOME: home, TMPDIR: home, NO_COLOR: "1", PATH: `${dirname(process.execPath)}:${dirname(zig)}:/usr/bin:/bin`, ZIG_LOCAL_CACHE_DIR: join(home, "zig-local"), ZIG_GLOBAL_CACHE_DIR: join(home, "zig-global"), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_REPLACE_OBJECTS: "1" }; }

export function countEvidence(receipt, privateEvidence) {
  const events = privateEvidence.trace.events;
  const model = events.filter((event) => event.interfaceLabel === "model.decide.v1").length; const nonModel = events.length - model;
  const checks = events.filter((event) => event.interfaceLabel === "repo.check.v1").length; const mutations = events.filter((event) => event.interfaceLabel === "repo.replace.approved.v2" && event.applied).length;
  assert.equal(receipt.external_effect_count, events.length); assert.equal(receipt.model_effect_count, model); assert.equal(receipt.non_model_effect_count, nonModel); assert.equal(receipt.check_count, checks); assert.equal(receipt.mutation_count, mutations);
  assert.equal(receipt.unique_changed_file_count, privateEvidence.changed_paths.length); assert.deepEqual(receipt.changed_paths, privateEvidence.changed_paths);
  return Object.freeze({ effects: events.length, model, nonModel, checks, mutations });
}

export function assertionResult(assertion, documents) {
  let hits = 0;
  for (const [path, contents] of Object.entries(documents)) {
    if (!(path === assertion.path_prefix || path.startsWith(`${assertion.path_prefix}/`))) continue;
    for (const line of contents.split("\n")) if (line.includes(assertion.query)) hits += 1;
  }
  const satisfied = assertion.expectation === "present" ? hits > 0 : assertion.expectation === "absent" ? hits === 0 : false;
  return Object.freeze({ query: assertion.query, path_prefix: assertion.path_prefix, expectation: assertion.expectation, hit_count: hits, satisfied });
}

export function buildChildVerificationRecord(value) {
  assert.ok(value.assertions.length >= 1 && value.assertions.every((item) => item.satisfied));
  assert.deepEqual(Object.keys(value.fileDigests).sort(), value.changedPaths);
  return Object.freeze({ format: "poiesis-child-verification/v1", child_candidate_sha256: value.candidateSha256, selection_commit: value.selectionCommit, repository: value.repository, base_revision: value.baseRevision, changed_paths: [...value.changedPaths], terminal_file_digests: { ...value.fileDigests }, final_diff_sha256: value.diffSha256, target_version: value.targetVersion, assertion_results: value.assertions, evidence_counts: value.counts, full_check_passed: true, approvals_verified: true, independent_verification: true, manual_file_edits: 0, unapproved_writes: 0 });
}

async function runDirectory(store) { const runs = (await readdir(join(store, "runs"))).sort(); assert.equal(runs.length, 1, "child store must contain exactly one run"); return join(store, "runs", runs[0]); }

async function fileDigests(worktree, paths, policy) {
  const writable = new Set(policy.writablePaths); const result = {};
  for (const path of paths) { assert.equal(writable.has(path), true, `${path} is not writable`); const status = await lstat(join(worktree, path)); assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= policy.limits.maximumFileBytes); const bytes = await readFile(join(worktree, path)); utf8.decode(bytes); result[path] = sha256(bytes); }
  return result;
}

async function readableDocuments(worktree, policy) {
  const result = {};
  for (const path of policy.readablePaths) { const status = await lstat(join(worktree, path)); assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= policy.limits.maximumFileBytes); result[path] = utf8.decode(await readFile(join(worktree, path))); }
  return result;
}

function verifySelection(poiesisRoot, selection, paths, candidateSha256) {
  assert.equal(selection.format, "poiesis-task-selection/v1"); assert.equal(selection.child_candidate_sha256, candidateSha256);
  const selectionPath = "conformance/poiesis-v1/selected-task/selection.json";
  const evidenceCommits = command("git", ["log", "--diff-filter=A", "--format=%H", "--", selectionPath], { cwd: poiesisRoot }).stdout.toString("utf8").trim().split("\n").filter(Boolean); assert.equal(evidenceCommits.length, 1);
  const taskPaths = paths.filter((path) => path !== selectionPath); const taskCommits = new Set();
  for (const path of taskPaths) { const commits = command("git", ["log", "--diff-filter=A", "--format=%H", "--", path], { cwd: poiesisRoot }).stdout.toString("utf8").trim().split("\n").filter(Boolean); assert.equal(commits.length, 1); taskCommits.add(commits[0]); }
  assert.equal(taskCommits.size, 1, "selected task inputs were not introduced together"); const selectionCommit = [...taskCommits][0]; assert.equal(selection.selection_commit, selectionCommit);
  assert.equal(command("git", ["rev-parse", `${evidenceCommits[0]}^`], { cwd: poiesisRoot }).stdout.toString("utf8").trim(), selectionCommit, "selection evidence is not the first child of the task commit");
  const firstParent = command("git", ["rev-parse", `${selectionCommit}^`], { cwd: poiesisRoot }).stdout.toString("utf8").trim();
  assert.equal(command("git", ["merge-base", "--is-ancestor", "refs/tags/poiesis-v1-child-candidate", firstParent], { cwd: poiesisRoot, allowFailure: true }).status, 0);
  for (const path of paths) assert.notEqual(command("git", ["cat-file", "-e", `refs/tags/poiesis-v1-child-candidate:${path}`], { cwd: poiesisRoot, allowFailure: true }).status, 0, `${path} existed at candidate freeze`);
  return selectionCommit;
}

async function verifyApprovals(runRoot, receipt, privateEvidence, bindingManifest) {
  const host = await import(pathToFileURL(join(privateEvidence.world_host_root, "src/v1/index.mjs")).href);
  const protocol = await import(pathToFileURL(join(privateEvidence.world_capabilities_root, "src/v1/protocol.mjs")).href);
  const replacementRequests = new Map();
  for (const encoded of privateEvidence.trace.frames) {
    const frame = host.decodeFrame(Buffer.from(encoded, "base64"));
    if (!frame.pendingEffect) continue;
    const interfaceEntry = bindingManifest.interfaces.find((entry) => entry.interfaceId === Buffer.from(frame.pendingEffect.interfaceId).toString("hex"));
    if (interfaceEntry?.interfaceLabel !== "repo.replace.approved.v2") continue;
    const request = protocol.decodeEffectRequest(frame.pendingEffect.encodedBytes); const requestId = Buffer.from(request.requestId).toString("hex"); const payload = decodeEffectPayload("replace", request.payloadBytes);
    replacementRequests.set(requestId, { requestId, payload: { operation: "replace", ...payload } });
  }
  assert.equal(receipt.approval_bindings.length, receipt.mutation_count);
  for (const binding of receipt.approval_bindings) {
    const approval = await json(join(runRoot, "approvals", `${binding.request_id}.json`));
    assert.equal(approval.format, "poiesis-approval/v1"); assert.equal(approval.applicationId, receipt.application_id); assert.equal(approval.runId, privateEvidence.run_id); assert.equal(approval.requestId, binding.request_id); assert.equal(approval.policyDigest, receipt.policy_sha256); assert.equal(approval.path, binding.path); assert.equal(approval.expectedSha256, binding.expected_sha256); assert.equal(approval.replacementSha256, binding.replacement_sha256); assert.equal(approval.proposalDigest, binding.proposal_digest); assert.equal(approval.approved, true);
    const request = replacementRequests.get(binding.request_id); assert.ok(request, "approval request is absent from retained Frames");
    assert.equal(workspaceAdapter.replacementProposalDigest({ applicationId: receipt.application_id, runId: privateEvidence.run_id, policyDigest: receipt.policy_sha256 }, request), binding.proposal_digest);
  }
}

export async function verifyChild(options) {
  const [poiesisRoot, targetRoot] = await Promise.all([realpath(options.poiesisRoot), realpath(options.targetRoot)]); if (inside(poiesisRoot, options.store) || inside(targetRoot, options.store)) throw new Error("verification store must remain private");
  const canonicalReceipt = join(poiesisRoot, "conformance/poiesis-v1/receipts/child.live.redacted.json"); assert.equal(options.receipt, canonicalReceipt);
  const [receipt, candidate, goal, rawPolicy, selection] = await Promise.all([json(options.receipt), json(options.candidate), json(options.goal), json(options.policy), json(join(poiesisRoot, "conformance/poiesis-v1/selected-task/selection.json"))]);
  const candidateSha256 = sha256(await readFile(options.candidate)); const taskSha256 = sha256(await readFile(options.task)); const goalSha256 = sha256(await readFile(options.goal));
  const policy = workspaceAdapter.admitWorkspacePolicy(rawPolicy, { repository: options.repository, baseRevision: options.baseRevision });
  assert.equal(selection.repository, options.repository); assert.equal(selection.base_revision, options.baseRevision); assert.equal(selection.task_sha256, taskSha256); assert.equal(selection.goal_sha256, goalSha256); assert.equal(selection.workspace_policy_sha256, policy.digest);
  const selectedPaths = ["conformance/poiesis-v1/selected-task/task.md", "conformance/poiesis-v1/selected-task/goal.json", "conformance/poiesis-v1/selected-task/workspace-policy.json", "conformance/poiesis-v1/selected-task/selection.json"];
  const selectionCommit = verifySelection(poiesisRoot, selection, selectedPaths, candidateSha256);
  assert.equal(candidate.format, "poiesis-child-candidate/v1"); assert.equal(candidate.application_id, receipt.application_id); assert.equal(candidate.application_wasm_sha256, receipt.application_wasm_sha256); assert.equal(candidate.source_commit, receipt.child_source_commit);
  assert.equal(receipt.child_candidate_sha256, candidateSha256); assert.equal(receipt.repository, options.repository); assert.equal(receipt.base_revision, options.baseRevision); assert.equal(receipt.task_sha256, taskSha256); assert.equal(receipt.goal_sha256, goalSha256); assert.equal(receipt.policy_sha256, policy.digest); assert.equal(receipt.terminal_status, "completed"); assert.equal(receipt.typed_final_result, true); assert.equal(receipt.manual_file_edits, 0); assert.equal(receipt.unapproved_writes, 0);
  assert.equal(receipt.openai_tools_count, 0); assert.equal(receipt.openai_store, false); assert.equal(receipt.openai_api_key_recorded, false); assert.equal(receipt.raw_prompt_recorded, false); assert.equal(receipt.raw_repository_content_recorded, false); assert.equal(receipt.raw_model_output_recorded, false);
  const runRoot = await runDirectory(options.store); const worktree = await realpath(join(runRoot, "worktree")); const privateEvidence = await json(join(runRoot, "private-evidence.json"), 64 * 1024 * 1024); assert.equal(sha256(await readFile(join(runRoot, "private-evidence.json"))), receipt.private_evidence_digest);
  assert.equal(command("git", ["rev-parse", "HEAD"], { cwd: worktree }).stdout.toString("utf8").trim(), options.baseRevision); assert.equal(command("git", ["ls-files", "--others", "--exclude-standard"], { cwd: worktree }).stdout.length, 0);
  const changedPaths = command("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", options.baseRevision, "--"], { cwd: worktree }).stdout.toString("utf8").trim().split("\n").filter(Boolean); assert.deepEqual(changedPaths, receipt.changed_paths); assert.ok(changedPaths.length >= 2 && changedPaths.length <= 4);
  assert.equal(command("git", ["diff", "--summary", options.baseRevision, "--", ...changedPaths], { cwd: worktree }).stdout.length, 0); const numstat = command("git", ["diff", "--numstat", options.baseRevision, "--", ...changedPaths], { cwd: worktree }).stdout.toString("utf8"); assert.equal(numstat.split("\n").some((line) => line.startsWith("-\t") || line.includes("\t-\t")), false);
  const digests = await fileDigests(worktree, changedPaths, policy.policy); assert.deepEqual(digests, receipt.terminal_file_digests); assert.deepEqual(digests, privateEvidence.terminal_file_digests);
  const diff = command("git", ["diff", "--binary", "--no-ext-diff", "--full-index", options.baseRevision, "--", ...changedPaths], { cwd: worktree }).stdout; assert.equal(sha256(diff), receipt.final_diff_sha256); assert.equal(receipt.final_diff_sha256, privateEvidence.final_diff_sha256);
  const counts = countEvidence(receipt, privateEvidence); const documents = await readableDocuments(worktree, policy.policy); const assertions = goal.assertions.map((assertion) => assertionResult(assertion, documents)); assert.ok(assertions.every((value) => value.satisfied)); assert.equal(receipt.assertions_satisfied, assertions.length); assert.equal(privateEvidence.final_result.target_version, goal.target_version); assert.equal(privateEvidence.final_result.current_version, goal.current_version); assert.deepEqual(privateEvidence.final_result.changed_files, changedPaths);
  const bindingManifest = await Bun.file(join(poiesisRoot, "zig-out/release-steward/release-steward.binding-manifest.json")).json(); await verifyApprovals(runRoot, receipt, privateEvidence, bindingManifest);
  const home = await mkdtemp(join(options.store, "child-independent-home-")); const environment = fixedEnvironment(home, options.zigExecutable); command(options.zigExecutable, ["build", "check", "--summary", "all"], { cwd: worktree, env: environment });
  const record = buildChildVerificationRecord({ candidateSha256, selectionCommit, repository: options.repository, baseRevision: options.baseRevision, changedPaths, fileDigests: digests, diffSha256: receipt.final_diff_sha256, targetVersion: goal.target_version, assertions, counts }); const recordBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`); const verificationPath = join(options.store, "child.verification.json");
  try { await writeFile(verificationPath, recordBytes, { flag: "wx", mode: 0o600 }); } catch (error) { if (error?.code !== "EEXIST" || !Buffer.from(await readFile(verificationPath)).equals(recordBytes)) throw error; }
  const verifiedReceipt = { ...receipt, final_check_passed: true, independent_verifier_passed: true }; const receiptBytes = Buffer.from(`${JSON.stringify(verifiedReceipt, null, 2)}\n`); const temporary = `${options.receipt}.tmp`; await writeFile(temporary, receiptBytes, { flag: "wx", mode: 0o644 }); await rename(temporary, options.receipt); assert.equal(sha256(await readFile(options.receipt)), sha256(receiptBytes));
  return Object.freeze({ record, verificationPath, verificationDigest: sha256(recordBytes), worktree });
}

if (import.meta.main) { const result = await verifyChild(parseArgs(process.argv.slice(2))); process.stdout.write(`poiesis_child_verification=${result.verificationPath}\npoiesis_child_verification_sha256=${result.verificationDigest}\n`); }

export const _childVerifierInternals = Object.freeze({ parseArgs });
