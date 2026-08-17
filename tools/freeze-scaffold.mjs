import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

const defaultTag = "poiesis-v1-scaffold";
const writablePaths = Object.freeze(["src/generated_definition.zig", "src/generated_epistemics.zig", "src/generated_policy.zig", "test/generated_semantics.zig"]);
const requiredImmutablePaths = Object.freeze([
  ".github/workflows/check.yml", "LICENSE", "README.md", "build.zig", "build.zig.zon", "package.json",
  "scaffold/agent_epistemics_guide.md", "scaffold/application.zig", "scaffold/emit_binding_manifest.zig", "scaffold/emit_codec_vectors.zig", "scaffold/emit_decision_contract.zig", "scaffold/emit_initial_args.zig", "scaffold/release_contract.zig", "scaffold/wasm_main.zig", "scaffold/working_set_helpers.zig",
  "scaffold/runtime/bindings.mjs", "scaffold/runtime/codecs.mjs", "scaffold/runtime/openai-adapter.mjs", "scaffold/runtime/workspace-adapter.mjs",
  "tools/acquire-parent.mjs", "tools/build-release.mjs", "tools/check-artifacts.mjs", "tools/check-lock.mjs", "tools/freeze-child.mjs", "tools/publish-birth.mjs", "tools/publish-child.mjs", "tools/run-birth.mjs", "tools/run-child.mjs", "tools/sparse-wasm-data.mjs", "tools/verify-birth.mjs", "tools/verify-child.mjs", "tools/verify-lineage.mjs", "tools/verify-parent.mjs",
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function command(executable, args, options = {}) { const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, stdout: "pipe", stderr: "pipe" }); const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0); if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`); return Object.freeze({ status: result.exitCode, stdout, stderr }); }

function parseArgs(argv) { const values = {}; for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!value || values[flag] || !["--repository-root", "--phase", "--tag"].includes(flag)) throw new Error(`invalid scaffold freeze option: ${String(flag)}`); values[flag] = value; } if (!isAbsolute(values["--repository-root"]) || !["tag", "evidence"].includes(values["--phase"])) throw new Error("absolute repository root and phase are required"); const tag = values["--tag"] ?? defaultTag; if (!/^poiesis-v1-scaffold(?:-r[1-9][0-9]*)?$/.test(tag)) throw new Error("invalid scaffold tag"); return Object.freeze({ repositoryRoot: resolve(values["--repository-root"]), phase: values["--phase"], tag }); }

function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }
export const canonicalPolicyDigest = (value) => sha256(Buffer.from(canonical(value)));

async function gitFile(root, revision, path) { return command("git", ["show", `${revision}:${path}`], { cwd: root }).stdout; }

export async function buildScaffoldLock(root, baselineCommit, briefBytes, policyBytes, baselineTag = defaultTag) {
  const tracked = command("git", ["ls-tree", "-r", "--name-only", baselineCommit], { cwd: root }).stdout.toString("utf8").trim().split("\n").filter(Boolean).sort();
  for (const path of requiredImmutablePaths) assert.ok(tracked.includes(path), `required scaffold path missing: ${path}`);
  const immutableFiles = {}; const writableStubs = {};
  for (const path of tracked) {
    const bytes = await gitFile(root, baselineCommit, path);
    if (writablePaths.includes(path)) writableStubs[path] = { git_blob_oid: command("git", ["rev-parse", `${baselineCommit}:${path}`], { cwd: root }).stdout.toString("utf8").trim(), sha256: sha256(bytes), maximum_bytes: 16 * 1024 };
    else immutableFiles[path] = sha256(bytes);
  }
  const policy = JSON.parse(policyBytes); assert.equal(policy.repository, "tkersey/poiesis"); assert.equal(policy.baseRevision, baselineCommit); assert.deepEqual(policy.writablePaths, writablePaths);
  const brief = new TextDecoder("utf-8", { fatal: true }).decode(briefBytes); assert.ok(brief.length > 0 && !brief.includes("```zig") && !brief.includes("diff --git"));
  return Object.freeze({ format: "poiesis-scaffold-lock/v1", baselineTag, baselineCommit, treeSha256: sha256(command("git", ["ls-tree", "-r", "-z", baselineCommit], { cwd: root }).stdout), immutableFiles, writableStubs, parentLockSha256: sha256(await gitFile(root, baselineCommit, "conformance/poiesis-v1/parent.lock.json")), childStackLockSha256: sha256(await gitFile(root, baselineCommit, "conformance/poiesis-v1/child-stack.lock.json")), birthBriefSha256: sha256(briefBytes), birthPolicySha256: canonicalPolicyDigest(policy) });
}

async function tagScaffold(root, tag) {
  assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.length, 0, "scaffold tag requires a clean tree"); command(process.execPath, ["run", "check"], { cwd: root });
  assert.notEqual(command("git", ["show-ref", "--verify", `refs/tags/${tag}`], { cwd: root, allowFailure: true }).status, 0, "scaffold tag already exists");
  const commit = command("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.toString("utf8").trim();
  command("git", ["-c", "user.name=Agent Poiesis Receiver", "-c", "user.email=poiesis@users.noreply.github.com", "tag", "--annotate", tag, "--message", "Agent Poiesis v1 immutable scaffold"], { cwd: root });
  assert.equal(command("git", ["rev-parse", `${tag}^{commit}`], { cwd: root }).stdout.toString("utf8").trim(), commit); return Object.freeze({ commit });
}

async function commitEvidence(root, tag) {
  const baselineCommit = command("git", ["rev-parse", `${tag}^{commit}`], { cwd: root }).stdout.toString("utf8").trim(); assert.equal(command("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.toString("utf8").trim(), baselineCommit);
  const briefPath = join(root, "conformance/poiesis-v1/birth-brief.md"); const policyPath = join(root, "conformance/poiesis-v1/birth-workspace-policy.json"); const lockPath = join(root, "conformance/poiesis-v1/scaffold.lock.json");
  const status = command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.toString("utf8").trim().split("\n").filter(Boolean).sort(); const allowedStatuses = [[], ["?? conformance/poiesis-v1/birth-workspace-policy.json"], ["?? conformance/poiesis-v1/birth-brief.md", "?? conformance/poiesis-v1/birth-workspace-policy.json"]]; assert.ok(allowedStatuses.some((allowed) => JSON.stringify(status) === JSON.stringify(allowed)), "evidence phase requires only the missing birth inputs");
  const [briefBytes, policyBytes] = await Promise.all([readFile(briefPath), readFile(policyPath)]); const lock = await buildScaffoldLock(root, baselineCommit, briefBytes, policyBytes, tag); await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx", mode: 0o644 });
  const paths = [relative(root, briefPath), relative(root, policyPath), relative(root, lockPath)].sort(); command("git", ["add", "--", ...paths], { cwd: root }); command("git", ["-c", "core.hooksPath=/dev/null", "-c", "user.name=Agent Poiesis Receiver", "-c", "user.email=poiesis@users.noreply.github.com", "commit", "--no-gpg-sign", "--message", "Bind scaffold birth evidence"], { cwd: root });
  const evidenceCommit = command("git", ["rev-parse", "HEAD"], { cwd: root }).stdout.toString("utf8").trim(); assert.equal(command("git", ["rev-parse", "HEAD^"], { cwd: root }).stdout.toString("utf8").trim(), baselineCommit); assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.length, 0); return Object.freeze({ baselineCommit, evidenceCommit, lock });
}

export async function freezeScaffold(options) { return options.phase === "tag" ? tagScaffold(options.repositoryRoot, options.tag) : commitEvidence(options.repositoryRoot, options.tag); }
if (import.meta.main) { const options = parseArgs(process.argv.slice(2)); const result = await freezeScaffold(options); process.stdout.write(`${JSON.stringify({ format: "poiesis-scaffold-freeze-result/v1", phase: options.phase, ...result })}\n`); }
export const _freezeScaffoldInternals = Object.freeze({ parseArgs, writablePaths });
