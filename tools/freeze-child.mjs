import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { runChild } from "./run-child.mjs";
import { verifyCurrent } from "./check-artifacts.mjs";

const semanticPaths = Object.freeze(["src/generated_definition.zig", "src/generated_epistemics.zig", "src/generated_policy.zig", "test/generated_semantics.zig"]);
const sourceTag = "poiesis-v1-child-source";
const candidateTag = "poiesis-v1-child-candidate";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function command(executable, args, options = {}) { const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" }); const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0); if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`); return Object.freeze({ status: result.exitCode, stdout, stderr }); }

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!value || values[flag] !== undefined || !["--repository-root", "--zig"].includes(flag)) throw new Error(`invalid child freeze option: ${String(flag)}`); values[flag] = value; }
  if (!values["--repository-root"] || !values["--zig"] || !isAbsolute(values["--repository-root"]) || !isAbsolute(values["--zig"])) throw new Error("absolute repository root and Zig executable are required");
  return Object.freeze({ repositoryRoot: resolve(values["--repository-root"]), zigExecutable: resolve(values["--zig"]) });
}

async function copied(source, destination) { await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); await chmod(destination, 0o644); assert.equal(sha256(await readFile(source)), sha256(await readFile(destination))); }

export function buildCandidate(value) {
  const candidate = {
    format: "poiesis-child-candidate/v1",
    source_commit: value.sourceCommit,
    source_tree_sha256: value.sourceTreeSha256,
    application_id: value.applicationId,
    application_wasm_sha256: value.applicationWasmSha256,
    application_manifest_sha256: value.applicationManifestSha256,
    decision_contract_digest: value.decisionContractDigest,
    binding_manifest_sha256: value.bindingManifestSha256,
    codec_module_sha256: value.codecModuleSha256,
    workspace_adapter_sha256: value.workspaceAdapterSha256,
    openai_adapter_sha256: value.openaiAdapterSha256,
    runtime_manifest_sha256: value.runtimeManifestSha256,
    child_stack_lock_sha256: value.childStackLockSha256,
    deterministic_receipt_sha256: value.deterministicReceiptSha256,
    retry_receipt_sha256: value.retryReceiptSha256,
    replay_receipt_sha256: value.replayReceiptSha256,
    measurement_receipt_sha256: value.measurementReceiptSha256,
  };
  for (const [name, field] of Object.entries(candidate)) {
    if (["format", "source_commit"].includes(name)) continue;
    assert.match(field, /^[0-9a-f]{64}$/, `${name} is not a SHA-256 digest`);
  }
  assert.match(candidate.source_commit, /^[0-9a-f]{40}$/);
  return Object.freeze(candidate);
}

export async function freezeChild(options) {
  const root = options.repositoryRoot; assert.equal(command("git", ["rev-parse", "--show-toplevel"], { cwd: root }).stdout.toString("utf8").trim(), root);
  assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.length, 0, "child freeze requires a clean tree");
  assert.equal(command(options.zigExecutable, ["version"]).stdout.toString("utf8").trim(), "0.16.0");
  const sourceCommit = command("git", ["rev-parse", `${sourceTag}^{commit}`], { cwd: root }).stdout.toString("utf8").trim(); assert.equal(command("git", ["merge-base", "--is-ancestor", sourceTag, "HEAD"], { cwd: root, allowFailure: true }).status, 0);
  assert.equal(command("git", ["diff", "--quiet", sourceTag, "HEAD", "--", ...semanticPaths], { cwd: root, allowFailure: true }).status, 0, "child semantic source changed after source freeze");
  assert.notEqual(command("git", ["cat-file", "-e", `HEAD:conformance/poiesis-v1/selected-task/selection.json`], { cwd: root, allowFailure: true }).status, 0, "selected task exists before candidate freeze");
  await verifyCurrent({ repositoryRoot: root, expect: "generated" });
  command(options.zigExecutable, ["build", "check", "--summary", "all"], { cwd: root }); const testFiles = (await readdir(join(root, "scaffold/test"))).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `scaffold/test/${name}`); command(process.execPath, ["test", ...testFiles], { cwd: root });
  const receiptPaths = { deterministic: join(root, "conformance/poiesis-v1/receipts/child.deterministic.json"), retry: join(root, "conformance/poiesis-v1/receipts/child.retry.json"), replay: join(root, "conformance/poiesis-v1/receipts/child.replay.json"), measurement: join(root, "conformance/poiesis-v1/receipts/child.measurement.json") };
  await runChild({ mode: "deterministic", runId: "poiesis-v1-deterministic", zigExecutable: options.zigExecutable, receipt: receiptPaths.deterministic });
  await runChild({ mode: "retry", runId: "poiesis-v1-retry", zigExecutable: options.zigExecutable, receipt: receiptPaths.retry });
  await runChild({ mode: "replay", runId: "poiesis-v1-replay", zigExecutable: options.zigExecutable, receipt: receiptPaths.replay });
  await runChild({ mode: "measure", runId: "poiesis-v1-measure", zigExecutable: options.zigExecutable, receipt: receiptPaths.measurement });

  const artifactRoot = join(root, "zig-out/release-steward"); const generatedRoot = join(root, "runtime/generated");
  await copied(join(artifactRoot, "release-steward.binding-manifest.json"), join(generatedRoot, "binding-manifest.json"));
  await copied(join(artifactRoot, "release-steward.decision-contract.json"), join(generatedRoot, "decision-contract.json"));
  await copied(join(root, "scaffold/runtime/codecs.mjs"), join(generatedRoot, "codecs.mjs"));
  const binding = JSON.parse(await readFile(join(generatedRoot, "binding-manifest.json"), "utf8"));
  const runtimeManifest = {
    format: "poiesis-child-runtime-manifest/v1",
    application_id: binding.applicationId,
    application_wasm_sha256: sha256(await readFile(join(artifactRoot, "release-steward.world.wasm"))),
    application_manifest_sha256: sha256(await readFile(join(artifactRoot, "release-steward.manifest.bin"))),
    decision_contract_digest: binding.decisionContractDigest,
    binding_manifest_sha256: sha256(await readFile(join(generatedRoot, "binding-manifest.json"))),
    codec_module_sha256: sha256(await readFile(join(generatedRoot, "codecs.mjs"))),
    workspace_adapter_sha256: sha256(await readFile(join(root, "scaffold/runtime/workspace-adapter.mjs"))),
    openai_adapter_sha256: sha256(await readFile(join(root, "scaffold/runtime/openai-adapter.mjs"))),
    bindings_module_sha256: sha256(await readFile(join(root, "scaffold/runtime/bindings.mjs"))),
    child_stack_lock_sha256: sha256(await readFile(join(root, "conformance/poiesis-v1/child-stack.lock.json"))),
  };
  const runtimeManifestPath = join(generatedRoot, "runtime-manifest.json"); await writeFile(runtimeManifestPath, `${JSON.stringify(runtimeManifest, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  const sourceTreeBytes = command("git", ["ls-tree", "-r", "-z", sourceTag], { cwd: root }).stdout;
  const candidate = buildCandidate({ sourceCommit, sourceTreeSha256: sha256(sourceTreeBytes), applicationId: binding.applicationId, applicationWasmSha256: runtimeManifest.application_wasm_sha256, applicationManifestSha256: runtimeManifest.application_manifest_sha256, decisionContractDigest: binding.decisionContractDigest, bindingManifestSha256: runtimeManifest.binding_manifest_sha256, codecModuleSha256: runtimeManifest.codec_module_sha256, workspaceAdapterSha256: runtimeManifest.workspace_adapter_sha256, openaiAdapterSha256: runtimeManifest.openai_adapter_sha256, runtimeManifestSha256: sha256(await readFile(runtimeManifestPath)), childStackLockSha256: runtimeManifest.child_stack_lock_sha256, deterministicReceiptSha256: sha256(await readFile(receiptPaths.deterministic)), retryReceiptSha256: sha256(await readFile(receiptPaths.retry)), replayReceiptSha256: sha256(await readFile(receiptPaths.replay)), measurementReceiptSha256: sha256(await readFile(receiptPaths.measurement)) });
  const candidatePath = join(root, "conformance/poiesis-v1/child-candidate.json"); await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  const commitPaths = [candidatePath, ...Object.values(receiptPaths), join(generatedRoot, "binding-manifest.json"), join(generatedRoot, "decision-contract.json"), join(generatedRoot, "codecs.mjs"), runtimeManifestPath].map((path) => relative(root, path)).sort();
  command("git", ["add", "--", ...commitPaths], { cwd: root }); const staged = command("git", ["diff", "--cached", "--name-only"], { cwd: root }).stdout.toString("utf8").trim().split("\n").filter(Boolean); assert.deepEqual(staged, commitPaths);
  command("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Agent Poiesis Receiver", "-c", "user.email=poiesis@users.noreply.github.com", "commit", "--no-gpg-sign", "--message", "Freeze Agent Poiesis child candidate"], { cwd: root });
  assert.notEqual(command("git", ["show-ref", "--verify", `refs/tags/${candidateTag}`], { cwd: root, allowFailure: true }).status, 0, "candidate tag already exists");
  command("git", ["-c", "user.name=Agent Poiesis Receiver", "-c", "user.email=poiesis@users.noreply.github.com", "tag", "--annotate", candidateTag, "--message", "Agent Poiesis v1 child candidate"], { cwd: root });
  const candidateCommit = command("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.toString("utf8").trim(); assert.equal(command("git", ["rev-parse", `${candidateTag}^{commit}`], { cwd: root }).stdout.toString("utf8").trim(), candidateCommit); assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.length, 0);
  return Object.freeze({ candidate, candidateCommit, candidatePath });
}

if (import.meta.main) { const result = await freezeChild(parseArgs(process.argv.slice(2))); process.stdout.write(`poiesis_child_candidate=${result.candidatePath}\npoiesis_child_candidate_commit=${result.candidateCommit}\n`); }

export const _freezeChildInternals = Object.freeze({ parseArgs });
