import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryIdentity = "tkersey/poiesis";
const parentRelease = "v1.0.7";
const expectedChangedPaths = Object.freeze([
  "src/generated_definition.zig",
  "src/generated_epistemics.zig",
  "src/generated_policy.zig",
  "test/generated_semantics.zig",
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const values = {};
  const names = { "--repository-root": "repositoryRoot", "--base-revision": "baseRevision", "--zig": "zigExecutable", "--store": "store", "--receipt": "receipt" };
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]; const value = argv[index + 1];
    if (!names[name] || !value || values[names[name]] !== undefined) throw new Error(`invalid birth argument: ${String(name)}`);
    values[names[name]] = value;
  }
  for (const name of Object.values(names)) if (values[name] === undefined) throw new Error(`${name} is required`);
  for (const name of ["repositoryRoot", "zigExecutable", "store"]) if (!isAbsolute(values[name])) throw new Error(`${name} must be absolute`);
  if (!/^[0-9a-f]{40}$/.test(values.baseRevision)) throw new Error("baseRevision must be forty lowercase hexadecimal characters");
  return Object.freeze({
    repositoryRoot: resolve(values.repositoryRoot),
    baseRevision: values.baseRevision,
    zigExecutable: resolve(values.zigExecutable),
    store: resolve(values.store),
    receipt: resolve(values.receipt),
  });
}

function command(executable, args, options = {}) {
  const result = Bun.spawnSync([executable, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
  });
  if (result.error || result.exitCode !== 0) {
    const stdout = result.stdout ? Buffer.from(result.stdout).toString("utf8") : "";
    const stderr = result.stderr ? Buffer.from(result.stderr).toString("utf8") : "";
    throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`);
  }
  return result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0);
}

async function regularBytes(path, maximum) {
  const status = await lstat(path);
  assert.equal(status.isFile(), true, `${path} is not a regular file`);
  assert.equal(status.isSymbolicLink(), false, `${path} is a symbolic link`);
  assert.equal(status.nlink, 1, `${path} is hard linked`);
  assert.ok(status.size <= maximum, `${path} exceeds ${maximum} bytes`);
  return readFile(path);
}

async function json(path, maximum = 1024 * 1024) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await regularBytes(path, maximum)));
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function sanitizedEnvironment(store, zigExecutable) {
  const environment = { ...process.env };
  for (const name of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_REPLACE_REF_BASE", "NODE_OPTIONS", "BUN_OPTIONS"]) delete environment[name];
  environment.HOME = join(store, "operator-home");
  environment.PATH = `${dirname(process.execPath)}:${dirname(zigExecutable)}:/usr/bin:/bin`;
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_NO_REPLACE_OBJECTS = "1";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

export function birthReceiptFromParent(parent, context) {
  assert.equal(parent.praxis_format, 1);
  assert.equal(parent.mode, "live");
  assert.equal(parent.candidate_commit, context.parentCandidate.praxisCommit);
  assert.equal(parent.application_id, context.parentCandidate.applicationId);
  assert.equal(parent.application_wasm_sha256, context.parentCandidate.applicationWasmSha256);
  assert.equal(parent.repository, repositoryIdentity);
  assert.equal(parent.base_revision, context.scaffoldCommit);
  assert.equal(parent.policy_sha256, context.policyDigest);
  assert.equal(parent.terminal_status, "completed");
  assert.equal(parent.typed_final_result, true);
  assert.equal(parent.final_check_passed, true);
  assert.equal(parent.independent_verifier_passed, true);
  assert.equal(parent.manual_file_edits, 0);
  assert.equal(parent.unapproved_writes, 0);
  assert.equal(parent.raw_prompt_recorded, false);
  assert.equal(parent.raw_repository_content_recorded, false);
  assert.equal(parent.raw_model_output_recorded, false);
  assert.equal(parent.openai_api_key_recorded, false);
  assert.equal(parent.fresh_worker_per_step, true);
  assert.deepEqual(parent.changed_paths, expectedChangedPaths);
  assert.equal(parent.unique_changed_file_count, expectedChangedPaths.length);
  assert.deepEqual(Object.keys(parent.terminal_file_digests).sort(), expectedChangedPaths);
  assert.ok(Object.values(parent.terminal_file_digests).every((digest) => /^[0-9a-f]{64}$/.test(digest)));
  assert.ok(Number.isInteger(parent.mutation_count) && parent.mutation_count >= expectedChangedPaths.length && parent.mutation_count <= 10);
  assert.ok(Number.isInteger(parent.test_count) && parent.test_count >= parent.mutation_count + 1);
  assert.equal(parent.external_effect_count, parent.model_effect_count + parent.non_model_effect_count);
  for (const digest of [parent.genesis_frame_id, parent.terminal_frame_id, parent.final_diff_sha256, parent.private_evidence_digest]) assert.match(digest, /^[0-9a-f]{64}$/);
  return Object.freeze({
    poiesis_format: 1,
    mode: "birth",
    parent_release: parentRelease,
    parent_candidate_commit: parent.candidate_commit,
    parent_application_id: parent.application_id,
    parent_application_wasm_sha256: parent.application_wasm_sha256,
    scaffold_commit: context.scaffoldCommit,
    birth_brief_sha256: context.birthBriefSha256,
    workspace_policy_sha256: context.policyDigest,
    genesis_frame_id: parent.genesis_frame_id,
    terminal_frame_id: parent.terminal_frame_id,
    terminal_status: parent.terminal_status,
    external_effect_count: parent.external_effect_count,
    model_effect_count: parent.model_effect_count,
    non_model_effect_count: parent.non_model_effect_count,
    check_count: parent.test_count,
    mutation_count: parent.mutation_count,
    changed_paths: [...parent.changed_paths],
    terminal_file_digests: { ...parent.terminal_file_digests },
    final_diff_sha256: parent.final_diff_sha256,
    typed_final_result: parent.typed_final_result,
    full_check_passed: parent.final_check_passed,
    hidden_birth_verifier_passed: parent.independent_verifier_passed,
    fresh_worker_per_step: parent.fresh_worker_per_step,
    manual_file_edits: parent.manual_file_edits,
    unapproved_writes: parent.unapproved_writes,
    raw_prompt_recorded: parent.raw_prompt_recorded,
    raw_repository_content_recorded: parent.raw_repository_content_recorded,
    raw_model_output_recorded: parent.raw_model_output_recorded,
    openai_api_key_recorded: parent.openai_api_key_recorded,
    private_evidence_digest: parent.private_evidence_digest,
  });
}

export async function prepareBirthStore(store) {
  await mkdir(store, { recursive: false, mode: 0o700 });
  await Promise.all([
    mkdir(join(store, "operator-home"), { recursive: false, mode: 0o700 }),
    mkdir(join(store, "runs"), { recursive: false, mode: 0o700 }),
  ]);
}

export async function runBirth(options) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required");
  const repositoryRoot = await realpath(options.repositoryRoot);
  const gitRoot = command("git", ["rev-parse", "--show-toplevel"], { cwd: repositoryRoot }).toString("utf8").trim();
  assert.equal(await realpath(gitRoot), repositoryRoot, "repository root mismatch");
  command("git", ["cat-file", "-e", `${options.baseRevision}^{commit}`], { cwd: repositoryRoot });
  if (inside(repositoryRoot, options.store)) throw new Error("birth store must be outside the repository");
  const canonicalReceipt = join(repositoryRoot, "conformance/poiesis-v1/receipts/birth.live.redacted.json");
  assert.equal(options.receipt, canonicalReceipt, "birth receipt path mismatch");
  try { await lstat(options.store); throw new Error("birth store already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  try { await lstat(options.receipt); throw new Error("birth receipt already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; }

  const scaffoldLockPath = join(repositoryRoot, "conformance/poiesis-v1/scaffold.lock.json");
  const birthBriefPath = join(repositoryRoot, "conformance/poiesis-v1/birth-brief.md");
  const policyPath = join(repositoryRoot, "conformance/poiesis-v1/birth-workspace-policy.json");
  const scaffoldLock = await json(scaffoldLockPath);
  assert.equal(scaffoldLock.format, "poiesis-scaffold-lock/v1");
  assert.equal(scaffoldLock.baselineCommit, options.baseRevision, "scaffold baseline mismatch");
  const birthBrief = await regularBytes(birthBriefPath, 64 * 1024);
  assert.ok(birthBrief.length > 0, "birth brief is empty");
  new TextDecoder("utf-8", { fatal: true }).decode(birthBrief);
  const rawPolicy = await json(policyPath);
  assert.equal(rawPolicy.repository, repositoryIdentity);
  assert.equal(rawPolicy.baseRevision, options.baseRevision);
  assert.deepEqual(rawPolicy.writablePaths, expectedChangedPaths);
  assert.equal(command(options.zigExecutable, ["version"]).toString("utf8").trim(), "0.16.0");

  await prepareBirthStore(options.store);
  const environment = sanitizedEnvironment(options.store, options.zigExecutable);
  command(process.execPath, [join(repositoryRoot, "tools/verify-parent.mjs")], { cwd: repositoryRoot, env: environment });
  const parentRunner = join(repositoryRoot, ".poiesis/parent/runner");
  const parentCandidatePath = join(parentRunner, "conformance/praxis-v1/candidate.json");
  const parentCandidate = await json(parentCandidatePath);
  const workspaceAdapter = await import(pathToFileURL(join(parentRunner, "runtime/workspace-adapter.mjs")).href);
  const admitted = workspaceAdapter.admitWorkspacePolicy(rawPolicy, { repository: repositoryIdentity, baseRevision: options.baseRevision });
  const parentReceiptPath = join(options.store, "parent.live.redacted.json");
  command(process.execPath, [
    "tools/run.mjs", "--mode", "live",
    "--repository-root", repositoryRoot,
    "--repository", repositoryIdentity,
    "--base-revision", options.baseRevision,
    "--task-file", birthBriefPath,
    "--policy", policyPath,
    "--zig", options.zigExecutable,
    "--candidate", parentCandidatePath,
    "--store", options.store,
    "--receipt", parentReceiptPath,
  ], { cwd: parentRunner, env: environment, inherit: true });

  const parentReceipt = await json(parentReceiptPath);
  const receipt = birthReceiptFromParent(parentReceipt, {
    scaffoldCommit: options.baseRevision,
    birthBriefSha256: sha256(birthBrief),
    policyDigest: admitted.digest,
    parentCandidate,
  });
  await mkdir(dirname(options.receipt), { recursive: true });
  await writeFile(options.receipt, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  const runDirectories = (await readdir(join(options.store, "runs"))).sort();
  assert.equal(runDirectories.length, 1, "birth store contains an unexpected run count");
  return Object.freeze({ receipt, runRoot: join(options.store, "runs", runDirectories[0]), worktree: join(options.store, "runs", runDirectories[0], "worktree") });
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const result = await runBirth(options);
  process.stdout.write(`poiesis_birth_receipt=${options.receipt}\npoiesis_birth_worktree=${result.worktree}\n`);
}

export const _birthInternals = Object.freeze({ expectedChangedPaths, parseArgs });
