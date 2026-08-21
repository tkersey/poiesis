import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const parentPath = new URL("../conformance/poiesis-v1/parent.lock.json", import.meta.url);
const childPath = new URL("../conformance/poiesis-v1/child-stack.lock.json", import.meta.url);
const packagePath = new URL("../build.zig.zon", import.meta.url);
const parent = JSON.parse(await readFile(parentPath, "utf8"));
const child = JSON.parse(await readFile(childPath, "utf8"));
const packageManifest = await readFile(packagePath, "utf8");
const hex64 = /^[0-9a-f]{64}$/;

assert.equal(parent.format, "poiesis-parent-lock/v1");
assert.equal(child.format, "poiesis-child-stack-lock/v1");
assert.deepEqual(parent.tuple, {
  agent: "2.5.0", boundary: "1.5.0", world: "3.1.3", worldHost: "1.0.2",
  worldCapabilities: "2.3.2", zig: "0.16.0", machineAbi: 2,
  machineStateFormat: "ABL_RNF2", applicationAbi: 1, frame: 1,
  effectProtocol: 1, maximumPendingEffects: 1,
});
assert.deepEqual(child.tuple, { ...parent.tuple, agent: "2.6.0" });
assert.deepEqual(parent.release, {
  repository: "tkersey/praxis", tag: "v1.0.5", tagCommit: "f46ebdf9e333950eb9577b7391fd7acbd8772923",
  candidateCommit: "f46ebdf9e333950eb9577b7391fd7acbd8772923",
  applicationId: "0b3aa252522d95adda4d090600503b6b9c56b01519c0d07a493564830e8cac75",
  applicationWasmSha256: "e79d46048bcad2f949a13bf99c6a885b86db379e84aa6ddf88fd713faced44d1",
  decisionContractDigest: "822764fac3476f73666a2439422486d557bd4aaf0defcea76dade3c61cd1fc5e",
  bindingManifestSha256: "9981b290ab6e0a94f594cca4eb96c170a2db188fb8ae9deaa79373594b72849b",
  workspaceAdapterSha256: "527930ea1e7b997b2f761e5ca4e082b600dc786d7fb458bb3c9011eed0e3d7e4",
  openaiAdapterSha256: "dd0dca92a4fb04cb059ce6839689aa42ff8a8f6d84664407c59b5ef35b6f69ad",
  codecsSha256: "dd05bfd6a80818def9bc2b738ce6db41e03722e4006617205896fca00c794e4b",
});

assert.deepEqual(parent.assets.map((asset) => asset.name), [
  "praxis-v1.0.5-artifacts.tar.gz",
  "praxis-v1.0.5-checksums.txt",
  "praxis-v1.0.5-runtime.tar.gz",
  "praxis-v1.0.5-source.tar.gz",
]);
for (const asset of parent.assets) {
  assert.match(asset.url, /^https:\/\/github\.com\/tkersey\/praxis\/releases\/download\/v1\.0\.5\//);
  assert.match(asset.sha256, hex64);
  assert.ok(Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0);
  assert.ok(Number.isSafeInteger(asset.maximumExpandedBytes) && asset.maximumExpandedBytes >= asset.sizeBytes || asset.expectedRoot === null);
}

for (const [name, archive] of Object.entries(child.archives)) {
  assert.match(archive.url, /^https:\/\/github\.com\/tkersey\//);
  assert.match(archive.sha256, hex64);
  assert.ok(typeof archive.root === "string" && archive.root.length > 0);
  assert.ok(Number.isSafeInteger(archive.maximumExpandedBytes) && archive.maximumExpandedBytes > 0);
  if (archive.packageHash) assert.match(archive.packageHash, new RegExp(`^${name === "worldHost" || name === "worldCapabilities" ? ".+" : name}-`));
  assert.ok(!archive.url.includes("/heads/") && !archive.url.includes("/main"));
}

for (const name of ["agent", "world"]) {
  const archive = child.archives[name];
  assert.ok(packageManifest.includes(`.url = "${archive.url}"`), `${name} URL differs from child lock`);
  assert.ok(packageManifest.includes(`.hash = "${archive.packageHash}"`), `${name} package hash differs from child lock`);
}
assert.ok(!packageManifest.includes(".path ="), "local path dependency is forbidden");

const digest = (value) => createHash("sha256").update(value).digest("hex");
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scaffoldPath = join(repositoryRoot, "conformance/poiesis-v1/scaffold.lock.json");

function command(args, allowFailure = false) {
  const result = Bun.spawnSync(["git", ...args], { cwd: repositoryRoot, stdout: "pipe", stderr: "pipe" });
  if (result.error || (!allowFailure && result.exitCode !== 0)) throw new Error(`git ${args.join(" ")} failed`);
  return { status: result.exitCode, stdout: result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0) };
}

function canonical(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`; }

async function verifyScaffoldLock() {
  try { await lstat(scaffoldPath); } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
  const lockBytes = await readFile(scaffoldPath); const lock = JSON.parse(lockBytes); assert.equal(lock.format, "poiesis-scaffold-lock/v1");
  const baselineTag = lock.baselineTag ?? "poiesis-v1-scaffold"; assert.match(baselineTag, /^poiesis-v1-scaffold(?:-r[1-9][0-9]*)?$/);
  assert.equal(command(["rev-parse", `${baselineTag}^{commit}`]).stdout.toString("utf8").trim(), lock.baselineCommit);
  assert.equal(digest(command(["ls-tree", "-r", "-z", lock.baselineCommit]).stdout), lock.treeSha256);
  const tracked = command(["ls-tree", "-r", "--name-only", lock.baselineCommit]).stdout.toString("utf8").trim().split("\n").filter(Boolean).sort();
  const classified = [...Object.keys(lock.immutableFiles), ...Object.keys(lock.writableStubs)].sort(); assert.deepEqual(classified, tracked);
  for (const [path, expected] of Object.entries(lock.immutableFiles)) assert.equal(digest(command(["show", `${lock.baselineCommit}:${path}`]).stdout), expected, `immutable scaffold digest mismatch: ${path}`);
  for (const [path, expected] of Object.entries(lock.writableStubs)) { const bytes = command(["show", `${lock.baselineCommit}:${path}`]).stdout; assert.equal(digest(bytes), expected.sha256); assert.equal(command(["rev-parse", `${lock.baselineCommit}:${path}`]).stdout.toString("utf8").trim(), expected.git_blob_oid); assert.ok(bytes.length <= expected.maximum_bytes); }
  assert.equal(lock.parentLockSha256, digest(command(["show", `${lock.baselineCommit}:conformance/poiesis-v1/parent.lock.json`]).stdout)); assert.equal(lock.childStackLockSha256, digest(command(["show", `${lock.baselineCommit}:conformance/poiesis-v1/child-stack.lock.json`]).stdout));
  const briefBytes = await readFile(join(repositoryRoot, "conformance/poiesis-v1/birth-brief.md")); const policyBytes = await readFile(join(repositoryRoot, "conformance/poiesis-v1/birth-workspace-policy.json")); assert.equal(digest(briefBytes), lock.birthBriefSha256); assert.equal(digest(Buffer.from(canonical(JSON.parse(policyBytes)))), lock.birthPolicySha256);
  const briefAtBaseline = command(["cat-file", "-e", `${lock.baselineCommit}:conformance/poiesis-v1/birth-brief.md`], true).status === 0; const policyAtBaseline = command(["cat-file", "-e", `${lock.baselineCommit}:conformance/poiesis-v1/birth-workspace-policy.json`], true).status === 0;
  const evidencePaths = ["conformance/poiesis-v1/scaffold.lock.json"]; if (!briefAtBaseline) evidencePaths.push("conformance/poiesis-v1/birth-brief.md"); if (!policyAtBaseline) evidencePaths.push("conformance/poiesis-v1/birth-workspace-policy.json");
  const commits = new Set(); for (const path of evidencePaths) { const value = command(["log", "-1", "--format=%H", "--", path]).stdout.toString("utf8").trim(); assert.match(value, /^[0-9a-f]{40}$/); commits.add(value); }
  assert.equal(commits.size, 1); const evidenceCommit = [...commits][0]; assert.equal(command(["rev-parse", `${evidenceCommit}^`]).stdout.toString("utf8").trim(), lock.baselineCommit);
  if (briefAtBaseline) assert.equal(digest(command(["show", `${lock.baselineCommit}:conformance/poiesis-v1/birth-brief.md`]).stdout), lock.birthBriefSha256); if (policyAtBaseline) assert.equal(digest(Buffer.from(canonical(JSON.parse(command(["show", `${lock.baselineCommit}:conformance/poiesis-v1/birth-workspace-policy.json`]).stdout)))), lock.birthPolicySha256);
  return digest(lockBytes);
}

const scaffoldDigest = await verifyScaffoldLock();
process.stdout.write(`parent_lock_sha256=${digest(await readFile(parentPath))}\nchild_stack_lock_sha256=${digest(await readFile(childPath))}\n${scaffoldDigest ? `scaffold_lock_sha256=${scaffoldDigest}\n` : ""}locks=true\n`);
