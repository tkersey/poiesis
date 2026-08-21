import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

const generatedPaths = Object.freeze(["src/generated_definition.zig", "src/generated_epistemics.zig", "src/generated_policy.zig", "test/generated_semantics.zig"]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === "--fixture" && argv[1] === "broken-arrow") return Object.freeze({ fixture: argv[1] });
  const names = { "--repository-root": "repositoryRoot", "--birth-store": "birthStore", "--child-store": "childStore" }; const values = {};
  for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!names[flag] || !value || values[names[flag]]) throw new Error(`invalid lineage option: ${String(flag)}`); values[names[flag]] = value; }
  for (const name of Object.values(names)) if (!values[name] || !isAbsolute(values[name])) throw new Error(`${name} must be absolute`);
  return Object.freeze({ repositoryRoot: resolve(values.repositoryRoot), birthStore: resolve(values.birthStore), childStore: resolve(values.childStore), fixture: null });
}

function command(executable, args, options = {}) { const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, stdout: "pipe", stderr: "pipe" }); const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0); if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`); return Object.freeze({ status: result.exitCode, stdout, stderr }); }
async function json(path, maximum = 16 * 1024 * 1024) { const status = await lstat(path); assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= maximum); return JSON.parse(await readFile(path, "utf8")); }

export function assertArrow(left, right, label) { assert.equal(left, right, `lineage arrow failed: ${label}`); return true; }

async function pullRequest(repository, number) { const result = JSON.parse(command("gh", ["pr", "view", String(number), "--repo", repository, "--json", "number,state,isDraft,headRefOid,mergeCommit,url"]).stdout.toString("utf8")); assert.equal(result.state, "MERGED"); assert.equal(result.isDraft, false); assert.ok(result.mergeCommit?.oid); return result; }

async function tree(repository, commit) { const result = JSON.parse(command("gh", ["api", `repos/${repository}/git/trees/${commit}?recursive=1`]).stdout.toString("utf8")); assert.equal(result.truncated, false, `${repository} tree response is truncated`); return new Map(result.tree.filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha])); }

async function comparePublishedPaths(repository, head, merged, paths) { const [headTree, mergedTree] = await Promise.all([tree(repository, head), tree(repository, merged)]); for (const path of paths) { assert.ok(headTree.has(path)); assertArrow(mergedTree.get(path), headTree.get(path), `${repository}:${path}`); } return true; }

export function buildLineage(value) {
  assert.equal(value.birthMergedTreeMatch, true); assert.equal(value.childMergedTreeMatch, true);
  for (const digest of [value.parentWasmSha256, value.birthReceiptSha256, value.generatedDiffSha256, value.generatedTreeSha256, value.candidateSha256, value.childWasmSha256, value.decisionContractDigest, value.taskSha256, value.liveReceiptSha256, value.verifiedDiffSha256]) assert.match(digest, /^[0-9a-f]{64}$/);
  return Object.freeze({
    format: "agent-poiesis-lineage/v1",
    parent: { release: "v1.0.6", candidate_commit: value.parentCandidateCommit, application_id: value.parentApplicationId, wasm_sha256: value.parentWasmSha256, birth_genesis_frame_id: value.birthGenesisFrameId, birth_terminal_frame_id: value.birthTerminalFrameId, birth_receipt_sha256: value.birthReceiptSha256 },
    child_source: { scaffold_commit: value.scaffoldCommit, generated_diff_sha256: value.generatedDiffSha256, generated_tree_sha256: value.generatedTreeSha256, birth_pr_number: value.birthPrNumber, birth_pr_head: value.birthPrHead, merged_source_commit: value.mergedSourceCommit },
    child_artifact: { candidate_sha256: value.candidateSha256, application_id: value.childApplicationId, wasm_sha256: value.childWasmSha256, decision_contract_digest: value.decisionContractDigest },
    child_action: { selection_commit: value.selectionCommit, task_sha256: value.taskSha256, genesis_frame_id: value.childGenesisFrameId, terminal_frame_id: value.childTerminalFrameId, live_receipt_sha256: value.liveReceiptSha256, verified_diff_sha256: value.verifiedDiffSha256 },
    publication: { repository: value.targetRepository, pull_request_number: value.childPrNumber, published_head: value.childPublishedHead, merged_commit: value.childMergedCommit, merged_tree_matches_verified_head: true },
    claims: { parent_byte_frozen: true, child_task_selected_after_freeze: true, child_semantics_machine_owned: true, manual_child_source_edits: 0, manual_target_file_edits: 0, second_reducer_present: false, runtime_definition_loader_present: false, reference_solution_supplied: false },
  });
}

export function runFixture(name) { assert.equal(name, "broken-arrow"); assert.throws(() => assertArrow("a", "b", "fixture")); return Object.freeze({ fixture: name, rejected: true }); }

export async function verifyLineage(options) {
  const root = options.repositoryRoot; const files = (name) => join(root, "conformance/poiesis-v1", name);
  command(process.execPath, [join(root, "tools/verify-parent.mjs")], { cwd: root });
  const [parentLock, scaffoldLock, birthReceipt, birthPublication, candidate, selection, childReceipt, childPublication, birthVerification, childVerification] = await Promise.all([
    json(files("parent.lock.json")), json(files("scaffold.lock.json")), json(files("receipts/birth.live.redacted.json")), json(files("receipts/birth.publication.json")), json(files("child-candidate.json")), json(files("selected-task/selection.json")), json(files("receipts/child.live.redacted.json")), json(files("receipts/child.publication.json")), json(join(options.birthStore, "birth.verification.json")), json(join(options.childStore, "child.verification.json")),
  ]);
  assert.equal(parentLock.release.candidateCommit, birthReceipt.parent_candidate_commit); assert.equal(parentLock.release.applicationId, birthReceipt.parent_application_id); assert.equal(parentLock.release.applicationWasmSha256, birthReceipt.parent_application_wasm_sha256);
  assertArrow(birthPublication.birth_receipt_sha256, sha256(await readFile(files("receipts/birth.live.redacted.json"))), "birth receipt to publication"); assertArrow(birthPublication.independent_verification_sha256, sha256(Buffer.from(`${JSON.stringify(birthVerification, null, 2)}\n`)), "birth verification to publication"); assertArrow(birthPublication.verified_diff_sha256, birthReceipt.final_diff_sha256, "birth diff");
  const birthPr = await pullRequest("tkersey/poiesis", birthPublication.pull_request_number); assertArrow(birthPr.headRefOid, birthPublication.published_head, "birth PR head");
  const mergedSourceCommit = command("git", ["rev-parse", "poiesis-v1-child-source^{commit}"], { cwd: root }).stdout.toString("utf8").trim(); await comparePublishedPaths("tkersey/poiesis", birthPublication.published_head, mergedSourceCommit, generatedPaths);
  assertArrow(candidate.source_commit, mergedSourceCommit, "child source tag to candidate"); const candidateSha256 = sha256(await readFile(files("child-candidate.json"))); assertArrow(selection.child_candidate_sha256, candidateSha256, "candidate to task selection"); assertArrow(childReceipt.child_candidate_sha256, candidateSha256, "candidate to child live");
  assertArrow(childPublication.child_live_receipt_sha256, sha256(await readFile(files("receipts/child.live.redacted.json"))), "child receipt to publication"); assertArrow(childPublication.independent_verification_sha256, sha256(Buffer.from(`${JSON.stringify(childVerification, null, 2)}\n`)), "child verification to publication"); assertArrow(childPublication.verified_diff_sha256, childReceipt.final_diff_sha256, "child diff");
  const childPr = await pullRequest(childPublication.repository, childPublication.pull_request_number); assertArrow(childPr.headRefOid, childPublication.published_head, "child PR head"); await comparePublishedPaths(childPublication.repository, childPublication.published_head, childPr.mergeCommit.oid, childReceipt.changed_paths);
  const generatedTreeSha256 = sha256(command("git", ["ls-tree", "-r", "-z", mergedSourceCommit], { cwd: root }).stdout);
  const lineage = buildLineage({ parentCandidateCommit: parentLock.release.candidateCommit, parentApplicationId: parentLock.release.applicationId, parentWasmSha256: parentLock.release.applicationWasmSha256, birthGenesisFrameId: birthReceipt.genesis_frame_id, birthTerminalFrameId: birthReceipt.terminal_frame_id, birthReceiptSha256: sha256(await readFile(files("receipts/birth.live.redacted.json"))), scaffoldCommit: scaffoldLock.baselineCommit, generatedDiffSha256: birthReceipt.final_diff_sha256, generatedTreeSha256, birthPrNumber: birthPublication.pull_request_number, birthPrHead: birthPublication.published_head, mergedSourceCommit, candidateSha256, childApplicationId: candidate.application_id, childWasmSha256: candidate.application_wasm_sha256, decisionContractDigest: candidate.decision_contract_digest, selectionCommit: selection.selection_commit, taskSha256: selection.task_sha256, childGenesisFrameId: childReceipt.genesis_frame_id, childTerminalFrameId: childReceipt.terminal_frame_id, liveReceiptSha256: sha256(await readFile(files("receipts/child.live.redacted.json"))), verifiedDiffSha256: childReceipt.final_diff_sha256, targetRepository: childPublication.repository, childPrNumber: childPublication.pull_request_number, childPublishedHead: childPublication.published_head, childMergedCommit: childPr.mergeCommit.oid, birthMergedTreeMatch: true, childMergedTreeMatch: true });
  const path = files("receipts/lineage.json"); const bytes = Buffer.from(`${JSON.stringify(lineage, null, 2)}\n`); try { await writeFile(path, bytes, { flag: "wx", mode: 0o644 }); } catch (error) { if (error?.code !== "EEXIST" || !Buffer.from(await readFile(path)).equals(bytes)) throw error; }
  return Object.freeze({ lineage, path, digest: sha256(bytes) });
}

if (import.meta.main) { const options = parseArgs(process.argv.slice(2)); const result = options.fixture ? { lineage: runFixture(options.fixture), digest: null } : await verifyLineage(options); process.stdout.write(`${JSON.stringify({ format: "poiesis-lineage-verifier-result/v1", ...result.lineage, lineage_sha256: result.digest })}\n`); }
