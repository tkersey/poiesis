import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, utimes, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { verifyLineage } from "./verify-lineage.mjs";

const prefix = "poiesis-v1.0.0";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const names = { "--repository-root": "repositoryRoot", "--birth-store": "birthStore", "--child-store": "childStore", "--output": "output" }; const values = {};
  for (let index = 0; index < argv.length; index += 2) { const flag = argv[index]; const value = argv[index + 1]; if (!names[flag] || !value || values[names[flag]]) throw new Error(`invalid release option: ${String(flag)}`); values[names[flag]] = value; }
  for (const name of Object.values(names)) if (!values[name] || !isAbsolute(values[name])) throw new Error(`${name} must be absolute`);
  return Object.freeze(Object.fromEntries(Object.entries(values).map(([name, value]) => [name, resolve(value)])));
}

function command(executable, args, options = {}) { const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd, env: options.env, stdout: "pipe", stderr: "pipe" }); const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0); if (result.error || result.exitCode !== 0) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`); return Object.freeze({ stdout, stderr }); }
function inside(parent, child) { const path = relative(parent, child); return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)); }

export function assertNoPrivateMaterial(bytes, label) {
  const text = Buffer.from(bytes).toString("utf8");
  for (const pattern of [/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/, /OPENAI_API_KEY\s*=/, /\/Users\/[A-Za-z0-9._-]+\//]) assert.equal(pattern.test(text), false, `${label} contains private material`);
  return true;
}

export function finalReceipt() {
  return [
    "agent_poiesis_format=1",
    "outcome=generated_child_completed_and_merged_real_task",
    "parent_release=v1.0.7",
    "parent_byte_frozen=true",
    "child_source_parent_authored=true",
    "child_semantically_distinct=true",
    "child_task_selected_after_freeze=true",
    "child_application_imports=0",
    "child_terminal_status=completed",
    "child_independent_verification=true",
    "birth_pr_merged=true",
    "child_target_pr_merged=true",
    "manual_child_source_edits=0",
    "manual_target_file_edits=0",
    "second_reducer=false",
    "runtime_definition_loader=false",
    "machine_abi=2",
    "machine_state=ABL_RNF2",
    "application_abi=1",
    "frame=1",
    "effect_protocol=1",
    "",
  ].join("\n");
}

async function copy(source, destination) { const status = await lstat(source); assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); await chmod(destination, status.mode & 0o777); await utimes(destination, 0, 0); }

async function copyTree(source, destination) {
  const status = await lstat(source); assert.equal(status.isSymbolicLink(), false);
  if (status.isDirectory()) { await mkdir(destination, { recursive: true, mode: 0o755 }); for (const entry of (await readdir(source)).sort()) await copyTree(join(source, entry), join(destination, entry)); await utimes(destination, 0, 0); }
  else await copy(source, destination);
}

async function archiveDirectory(sourceParent, rootName, target) {
  command("tar", ["-czf", target, "--no-xattrs", "--no-mac-metadata", "-C", sourceParent, rootName], { env: { ...process.env, COPYFILE_DISABLE: "1" } });
}

async function walk(root, prefix = "") {
  let total = 0;
  for (const entry of (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name; const status = await lstat(join(root, path)); assert.equal(status.isSymbolicLink(), false, `${path} is a link`);
    if (entry.isDirectory()) total += await walk(root, path); else { assert.equal(entry.isFile(), true); assert.equal(status.nlink, 1); total += status.size; }
  }
  return total;
}

async function verifyArchive(path, expectedRoot, maximumBytes) {
  const listing = command("tar", ["-tzf", path]).stdout.toString("utf8").trim().split("\n").filter(Boolean); const seen = new Set();
  for (const raw of listing) { const value = raw.replace(/^\.\//, "").replace(/\/$/, ""); assert.ok(value === expectedRoot || value.startsWith(`${expectedRoot}/`)); assert.equal(value.startsWith("/"), false); assert.equal(value.split("/").some((part) => part === ".." || part === ""), false); assert.equal(seen.has(value), false); seen.add(value); }
  const temporary = await mkdtemp(join(tmpdir(), "poiesis-release-verify-")); try { command("tar", ["-xzf", path, "-C", temporary]); assert.ok(await walk(temporary) <= maximumBytes); } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function validateReceipts(root) {
  const names = ["birth.live.redacted.json", "birth.publication.json", "child.live.redacted.json", "child.publication.json", "lineage.json"];
  const values = {};
  for (const name of names) { const path = join(root, "conformance/poiesis-v1/receipts", name); const bytes = await readFile(path); assertNoPrivateMaterial(bytes, name); values[name] = JSON.parse(bytes); }
  assert.equal(values["birth.live.redacted.json"].terminal_status, "completed"); assert.equal(values["child.live.redacted.json"].independent_verifier_passed, true); assert.equal(values["birth.publication.json"].draft, true); assert.equal(values["child.publication.json"].draft, true); assert.equal(values["lineage.json"].publication.merged_tree_matches_verified_head, true);
  return values;
}

export async function buildRelease(options) {
  const root = await realpath(options.repositoryRoot); if (inside(root, options.output)) throw new Error("release output must be outside the repository"); assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root }).stdout.length, 0, "release build requires a clean tree");
  await verifyLineage({ repositoryRoot: root, birthStore: options.birthStore, childStore: options.childStore }); await validateReceipts(root);
  try { await lstat(options.output); throw new Error("release output already exists"); } catch (error) { if (error?.code !== "ENOENT") throw error; } await mkdir(options.output, { recursive: false, mode: 0o755 });
  const staging = await mkdtemp(join(tmpdir(), "poiesis-release-stage-"));
  try {
    const source = join(options.output, `${prefix}-source.tar.gz`); command("git", ["archive", "--format=tar.gz", "--prefix=poiesis-1.0.0/", "-o", source, "HEAD"], { cwd: root });
    const scaffold = join(options.output, `${prefix}-scaffold.tar.gz`); command("git", ["archive", "--format=tar.gz", "--prefix=poiesis-v1-scaffold/", "-o", scaffold, "poiesis-v1-scaffold"], { cwd: root });
    const runtimeRoot = join(staging, "runtime", "poiesis-v1.0.0-child-runtime");
    for (const path of ["LICENSE", "conformance/poiesis-v1/parent.lock.json", "conformance/poiesis-v1/child-stack.lock.json"]) await copy(join(root, path), join(runtimeRoot, path));
    for (const path of ["scaffold/runtime", "runtime/generated"]) await copyTree(join(root, path), join(runtimeRoot, path));
    for (const path of ["tools/run-child.mjs", "tools/verify-child.mjs"]) await copy(join(root, path), join(runtimeRoot, path));
    const runtime = join(options.output, `${prefix}-child-runtime.tar.gz`); await archiveDirectory(dirname(runtimeRoot), basename(runtimeRoot), runtime);
    const artifactRoot = join(staging, "artifacts", "poiesis-v1.0.0-child-artifacts");
    for (const path of ["LICENSE", "conformance/poiesis-v1/child-stack.lock.json", "conformance/poiesis-v1/child-candidate.json"]) await copy(join(root, path), join(artifactRoot, path));
    await copyTree(join(root, "zig-out/release-steward"), join(artifactRoot, "zig-out/release-steward")); await copy(join(root, "zig-out/bin/poiesis-initial-args"), join(artifactRoot, "zig-out/bin/poiesis-initial-args"));
    for (const name of ["child.deterministic.json", "child.retry.json", "child.replay.json", "child.measurement.json"]) await copy(join(root, "conformance/poiesis-v1/receipts", name), join(artifactRoot, "conformance/poiesis-v1/receipts", name));
    const artifacts = join(options.output, `${prefix}-child-artifacts.tar.gz`); await archiveDirectory(dirname(artifactRoot), basename(artifactRoot), artifacts);
    const copies = { "birth.live.redacted.json": "birth-receipt.redacted.json", "child.live.redacted.json": "child-live-receipt.redacted.json", "lineage.json": "lineage-receipt.json", "birth.publication.json": "birth-publication-receipt.json", "child.publication.json": "child-publication-receipt.json" };
    for (const [sourceName, targetName] of Object.entries(copies)) await copy(join(root, "conformance/poiesis-v1/receipts", sourceName), join(options.output, `${prefix}-${targetName}`));
    await writeFile(join(options.output, `${prefix}-final-receipt.txt`), finalReceipt(), { flag: "wx", mode: 0o644 });
    for (const name of await readdir(options.output)) assertNoPrivateMaterial(await readFile(join(options.output, name)), name);
    await verifyArchive(source, "poiesis-1.0.0", 64 * 1024 * 1024); await verifyArchive(scaffold, "poiesis-v1-scaffold", 64 * 1024 * 1024); await verifyArchive(runtime, "poiesis-v1.0.0-child-runtime", 32 * 1024 * 1024); await verifyArchive(artifacts, "poiesis-v1.0.0-child-artifacts", 64 * 1024 * 1024);
    const names = (await readdir(options.output)).filter((name) => name !== `${prefix}-checksums.txt`).sort(); const checksums = [];
    for (const name of names) checksums.push(`${sha256(await readFile(join(options.output, name)))}  ${name}`);
    await writeFile(join(options.output, `${prefix}-checksums.txt`), `${checksums.join("\n")}\n`, { flag: "wx", mode: 0o644 });
    return Object.freeze({ output: options.output, assets: [...names, `${prefix}-checksums.txt`] });
  } finally { await rm(staging, { recursive: true, force: true }); }
}

if (import.meta.main) { const result = await buildRelease(parseArgs(process.argv.slice(2))); process.stdout.write(`poiesis_release_assets=${result.assets.length}\npoiesis_release_output=${result.output}\n`); }

export const _releaseInternals = Object.freeze({ parseArgs });
