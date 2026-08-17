import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { _birthInternals } from "./run-birth.mjs";

const expectedChangedPaths = _birthInternals.expectedChangedPaths;
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  if (argv.length === 2 && argv[0] === "--fixture" && argv[1] === "unauthorized-write") return Object.freeze({ fixture: argv[1] });
  const names = { "--repository-root": "repositoryRoot", "--store": "store", "--zig": "zigExecutable", "--receipt": "receipt" };
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]; const value = argv[index + 1];
    if (!names[flag] || !value || values[names[flag]] !== undefined) throw new Error(`invalid birth verification argument: ${String(flag)}`);
    values[names[flag]] = value;
  }
  for (const name of Object.values(names)) if (values[name] === undefined) throw new Error(`${name} is required`);
  for (const name of ["repositoryRoot", "store", "zigExecutable"]) if (!isAbsolute(values[name])) throw new Error(`${name} must be absolute`);
  return Object.freeze({ repositoryRoot: resolve(values.repositoryRoot), store: resolve(values.store), zigExecutable: resolve(values.zigExecutable), receipt: resolve(values.receipt), fixture: null });
}

function command(executable, args, options = {}) {
  const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0);
  const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0);
  if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`);
  return Object.freeze({ status: result.exitCode, stdout, stderr });
}

async function json(path, maximum = 1024 * 1024) {
  const status = await lstat(path); assert.equal(status.isFile(), true, `${path} is not a regular file`); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= maximum);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readFile(path)));
}

export function assertBirthChangedPaths(paths) {
  assert.deepEqual(paths, expectedChangedPaths, "birth diff is not the exact four-file set");
}

export function buildVerificationRecord(value) {
  assertBirthChangedPaths(value.changedPaths);
  assert.deepEqual(Object.keys(value.fileDigests).sort(), expectedChangedPaths);
  for (const digest of [...Object.values(value.fileDigests), value.diffSha256, value.zigOutputSha256, value.bunOutputSha256, value.artifactOutputSha256]) assert.match(digest, /^[0-9a-f]{64}$/);
  return Object.freeze({
    format: "poiesis-birth-verification/v1",
    parent_candidate_commit: value.parentCandidateCommit,
    parent_application_id: value.parentApplicationId,
    scaffold_commit: value.scaffoldCommit,
    worktree_head: value.worktreeHead,
    changed_paths: [...value.changedPaths],
    terminal_file_digests: { ...value.fileDigests },
    final_diff_sha256: value.diffSha256,
    zig_check_output_sha256: value.zigOutputSha256,
    bun_check_output_sha256: value.bunOutputSha256,
    artifact_check_output_sha256: value.artifactOutputSha256,
    generated_semantics: true,
    full_check_passed: true,
    hidden_native_wasm_tests_passed: true,
    codec_parity_passed: true,
    zero_import_wasm: true,
    manual_file_edits: 0,
    unapproved_writes: 0,
    independent_verification: true,
  });
}

function fixedEnvironment(home, zigExecutable) {
  return {
    HOME: home,
    TMPDIR: home,
    NO_COLOR: "1",
    PATH: `${dirname(process.execPath)}:${dirname(zigExecutable)}:/usr/bin:/bin`,
    ZIG_LOCAL_CACHE_DIR: join(home, "zig-local"),
    ZIG_GLOBAL_CACHE_DIR: join(home, "zig-global"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function birthWorktree(store) {
  const runs = (await readdir(join(store, "runs"))).sort();
  assert.equal(runs.length, 1, "birth store must contain exactly one run");
  return realpath(join(store, "runs", runs[0], "worktree"));
}

async function currentFileDigests(worktree) {
  const result = {};
  for (const path of expectedChangedPaths) {
    const full = join(worktree, path); const status = await lstat(full);
    assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); assert.ok(status.size <= 16 * 1024);
    const bytes = await readFile(full); new TextDecoder("utf-8", { fatal: true }).decode(bytes); result[path] = sha256(bytes);
  }
  return result;
}

function gitPathExists(worktree, revision, path) {
  return command("git", ["cat-file", "-e", `${revision}:${path}`], { cwd: worktree, allowFailure: true }).status === 0;
}

export function runFixture(name) {
  assert.equal(name, "unauthorized-write");
  assert.throws(() => assertBirthChangedPaths([...expectedChangedPaths, "README.md"]));
  return Object.freeze({ fixture: name, rejected: true });
}

export async function verifyBirth(options) {
  const repositoryRoot = await realpath(options.repositoryRoot);
  const canonicalReceipt = join(repositoryRoot, "conformance/poiesis-v1/receipts/birth.live.redacted.json");
  assert.equal(options.receipt, canonicalReceipt, "birth receipt path mismatch");
  const parentVerifyHome = join(options.store, "parent-verify-home"); await mkdir(parentVerifyHome, { recursive: false, mode: 0o700 });
  command(process.execPath, [join(repositoryRoot, "tools/verify-parent.mjs")], { cwd: repositoryRoot, env: fixedEnvironment(parentVerifyHome, options.zigExecutable) });
  const [receipt, scaffoldLock] = await Promise.all([
    json(options.receipt),
    json(join(repositoryRoot, "conformance/poiesis-v1/scaffold.lock.json")),
  ]);
  assert.equal(receipt.poiesis_format, 1); assert.equal(receipt.mode, "birth"); assert.equal(receipt.terminal_status, "completed");
  assert.equal(receipt.full_check_passed, true); assert.equal(receipt.hidden_birth_verifier_passed, true);
  assert.equal(receipt.manual_file_edits, 0); assert.equal(receipt.unapproved_writes, 0);
  assert.equal(scaffoldLock.format, "poiesis-scaffold-lock/v1"); assert.equal(receipt.scaffold_commit, scaffoldLock.baselineCommit);
  const worktree = await birthWorktree(options.store);
  assert.equal(command("git", ["rev-parse", "HEAD"], { cwd: worktree }).stdout.toString("utf8").trim(), scaffoldLock.baselineCommit);
  const untracked = command("git", ["ls-files", "--others", "--exclude-standard"], { cwd: worktree }).stdout.toString("utf8").trim();
  assert.equal(untracked, "", "birth worktree contains untracked files");
  const changedPaths = command("git", ["diff", "--name-only", "--diff-filter=ACDMRTUXB", scaffoldLock.baselineCommit, "--"], { cwd: worktree }).stdout.toString("utf8").trim().split("\n").filter(Boolean);
  assertBirthChangedPaths(changedPaths);
  assert.equal(command("git", ["diff", "--summary", scaffoldLock.baselineCommit, "--", ...changedPaths], { cwd: worktree }).stdout.length, 0, "birth changed file modes or topology");
  const numstat = command("git", ["diff", "--numstat", scaffoldLock.baselineCommit, "--", ...changedPaths], { cwd: worktree }).stdout.toString("utf8").trim().split("\n");
  assert.ok(numstat.every((line) => !line.startsWith("-\t") && !line.includes("\t-\t")), "birth diff contains binary data");
  const fileDigests = await currentFileDigests(worktree);
  assert.deepEqual(fileDigests, receipt.terminal_file_digests, "terminal files changed after the parent Frame");
  for (const path of ["conformance/poiesis-v1/selected-task/selection.json", "conformance/poiesis-v1/child-candidate.json", "fixtures/release-steward-v1/expected", "tools/fixture-model-adapter.mjs"]) {
    assert.equal(gitPathExists(worktree, scaffoldLock.baselineCommit, path), false, `${path} existed at scaffold freeze`);
  }
  const diff = command("git", ["diff", "--binary", "--no-ext-diff", "--full-index", scaffoldLock.baselineCommit, "--", ...changedPaths], { cwd: worktree }).stdout;
  assert.equal(sha256(diff), receipt.final_diff_sha256, "birth diff digest mismatch");
  const verifyHome = join(options.store, "birth-independent-home"); await mkdir(verifyHome, { recursive: false, mode: 0o700 });
  const environment = fixedEnvironment(verifyHome, options.zigExecutable);
  const zigResult = command(options.zigExecutable, ["build", "check", "--summary", "all"], { cwd: worktree, env: environment });
  const zigOutput = Buffer.concat([zigResult.stdout, zigResult.stderr]);
  assert.equal(/\bskipped\b/.test(zigOutput.toString("utf8")), false, "generated hidden tests were skipped");
  const testFiles = (await readdir(join(worktree, "scaffold/test"))).filter((name) => name.endsWith(".test.mjs")).sort().map((name) => `scaffold/test/${name}`);
  const bunResult = command(process.execPath, ["test", ...testFiles], { cwd: worktree, env: environment });
  const artifactResult = command(process.execPath, ["tools/check-artifacts.mjs", "--repository-root", worktree, "--artifacts", join(worktree, "zig-out/release-steward"), "--expect", "generated"], { cwd: worktree, env: environment });
  assertBirthChangedPaths(command("git", ["diff", "--name-only", scaffoldLock.baselineCommit, "--"], { cwd: worktree }).stdout.toString("utf8").trim().split("\n").filter(Boolean));
  const record = buildVerificationRecord({
    parentCandidateCommit: receipt.parent_candidate_commit,
    parentApplicationId: receipt.parent_application_id,
    scaffoldCommit: scaffoldLock.baselineCommit,
    worktreeHead: scaffoldLock.baselineCommit,
    changedPaths,
    fileDigests,
    diffSha256: receipt.final_diff_sha256,
    zigOutputSha256: sha256(zigOutput),
    bunOutputSha256: sha256(Buffer.concat([bunResult.stdout, bunResult.stderr])),
    artifactOutputSha256: sha256(Buffer.concat([artifactResult.stdout, artifactResult.stderr])),
  });
  const verificationPath = join(options.store, "birth.verification.json");
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  await writeFile(verificationPath, bytes, { flag: "wx", mode: 0o600 });
  return Object.freeze({ record, verificationPath, verificationDigest: sha256(bytes), worktree });
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.fixture ? { record: runFixture(options.fixture) } : await verifyBirth(options);
  process.stdout.write(`${JSON.stringify({ format: "poiesis-birth-verifier-result/v1", ...result.record, verification_digest: result.verificationDigest ?? null })}\n`);
}

export const _birthVerifierInternals = Object.freeze({ parseArgs });
