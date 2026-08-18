import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { gunzipSync } from "node:zlib";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const defaultRoot = resolve(".poiesis/parent");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const cString = (bytes) => { const end = bytes.indexOf(0); return Buffer.from(end < 0 ? bytes : bytes.subarray(0, end)).toString("utf8"); };
const octal = (bytes, label) => { const value = cString(bytes).trim().replace(/^0+/, "") || "0"; if (!/^[0-7]+$/.test(value)) throw new Error(`invalid tar ${label}`); return Number.parseInt(value, 8); };

function parseArgs(argv) {
  let root = defaultRoot;
  for (let index = 0; index < argv.length; index += 2) {
    if (argv[index] !== "--root" || index + 1 >= argv.length) throw new Error("usage: acquire-parent [--root absolute-path]");
    root = resolve(argv[index + 1]);
  }
  return { root };
}

function tarEntries(compressed, asset) {
  const archive = gunzipSync(compressed); const entries = []; const names = new Set(); let offset = 0; let total = 0; let sawExpectedRoot = false;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512); offset += 512;
    if (header.every((byte) => byte === 0)) break;
    const expectedChecksum = octal(header.subarray(148, 156), "checksum");
    let actualChecksum = 0; for (let index = 0; index < 512; index += 1) actualChecksum += index >= 148 && index < 156 ? 0x20 : header[index];
    if (actualChecksum !== expectedChecksum) throw new Error(`tar checksum mismatch in ${asset.name}`);
    const prefix = cString(header.subarray(345, 500)); const name = cString(header.subarray(0, 100));
    const raw = `${prefix ? `${prefix}/` : ""}${name}`.replace(/^\.\//, "").replace(/\/$/, "");
    const size = octal(header.subarray(124, 136), "size"); const mode = octal(header.subarray(100, 108), "mode") & 0o777; const type = String.fromCharCode(header[156] || 48);
    const data = archive.subarray(offset, offset + size); if (data.length !== size) throw new Error(`truncated tar entry ${raw}`);
    offset += Math.ceil(size / 512) * 512; total += size;
    if (total > asset.maximumExpandedBytes) throw new Error(`expanded archive exceeds bound: ${asset.name}`);
    if (type === "g") {
      const match = Buffer.from(data).toString("utf8").match(/^\d+ comment=([0-9a-f]{40})\n$/);
      if (raw !== "pax_global_header" || !match || match[1] !== asset.allowedPaxComment) throw new Error(`unadmitted PAX metadata in ${asset.name}`);
      continue;
    }
    if (!raw) continue;
    if (raw.startsWith("/") || raw.includes("\\") || raw.split("/").some((part) => part === "" || part === "." || part === "..")) throw new Error(`unsafe tar path ${raw}`);
    if (names.has(raw)) throw new Error(`duplicate tar entry ${raw}`); names.add(raw);
    if (raw.split("/")[0] !== asset.expectedRoot) throw new Error(`unexpected archive root ${raw}`);
    sawExpectedRoot = true;
    if (type !== "0" && type !== "5") throw new Error(`links and special tar entries are forbidden: ${raw}`);
    if (type === "5" && size !== 0) throw new Error(`directory carries data: ${raw}`);
    entries.push({ name: raw, type, mode, data });
  }
  if (!sawExpectedRoot) throw new Error(`archive root missing: ${asset.expectedRoot}`);
  return entries;
}

async function download(asset, downloads) {
  await mkdir(downloads, { recursive: true, mode: 0o700 }); const destination = join(downloads, asset.name);
  let bytes;
  try { bytes = await readFile(destination); } catch { bytes = null; }
  if (!bytes || sha256(bytes) !== asset.sha256 || bytes.length !== asset.sizeBytes) {
    const response = await fetch(asset.url, { redirect: "follow" });
    if (!response.ok) throw new Error(`download failed ${asset.name}: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.sizeBytes || sha256(bytes) !== asset.sha256) throw new Error(`download identity mismatch: ${asset.name}`);
    const temporary = `${destination}.tmp`; await rm(temporary, { force: true }); await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 }); await rename(temporary, destination);
  }
  return { destination, bytes };
}

async function extract(asset, bytes, extracted) {
  const directory = join(extracted, asset.name.replace(/\.tar\.gz$/, "")); await rm(directory, { recursive: true, force: true }); await mkdir(directory, { recursive: true, mode: 0o700 });
  for (const entry of tarEntries(bytes, asset)) {
    const destination = join(directory, entry.name);
    if (entry.type === "5") await mkdir(destination, { recursive: true, mode: entry.mode || 0o755 });
    else { await mkdir(resolve(destination, ".."), { recursive: true, mode: 0o755 }); await writeFile(destination, entry.data, { flag: "wx", mode: entry.mode || 0o644 }); await chmod(destination, entry.mode || 0o644); }
  }
  return join(directory, asset.expectedRoot);
}

function command(executable, args, { cwd, environment }) {
  const result = spawnSync(executable, args, { cwd, env: environment, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim();
}

async function copyTree(source, destination) {
  const status = await lstat(source);
  if (status.isSymbolicLink() || (!status.isDirectory() && !status.isFile())) throw new Error(`runner source is not an ordinary file or directory: ${source}`);
  if (status.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: status.mode & 0o777 });
    for (const entry of (await readdir(source)).sort()) await copyTree(join(source, entry), join(destination, entry));
    return;
  }
  await mkdir(dirname(destination), { recursive: true, mode: 0o755 });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  await chmod(destination, status.mode & 0o777);
  if (sha256(await readFile(destination)) !== sha256(await readFile(source))) throw new Error(`runner copy digest mismatch: ${source}`);
}

async function materializeRunner(root, lock, roots) {
  const runner = join(root, "runner");
  await rm(runner, { recursive: true, force: true });
  await mkdir(runner, { recursive: true, mode: 0o700 });
  const gitHome = join(root, "git-home"); await mkdir(gitHome, { recursive: true, mode: 0o700 });
  const environment = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: gitHome,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_TERMINAL_PROMPT: "0",
  };
  command("git", ["init", "--quiet"], { cwd: runner, environment });
  const repositoryUrl = `https://github.com/${lock.release.repository}.git`;
  command("git", ["fetch", "--quiet", "--force", "--no-tags", repositoryUrl, `refs/tags/${lock.release.tag}:refs/tags/${lock.release.tag}`], { cwd: runner, environment });
  const taggedCommit = command("git", ["rev-parse", `${lock.release.tag}^{commit}`], { cwd: runner, environment });
  if (taggedCommit !== lock.release.tagCommit) throw new Error("parent release tag commit mismatch");
  command("git", ["cat-file", "-e", `${lock.release.candidateCommit}^{commit}`], { cwd: runner, environment });
  command("git", ["update-ref", "refs/heads/release", lock.release.tagCommit], { cwd: runner, environment });
  command("git", ["symbolic-ref", "HEAD", "refs/heads/release"], { cwd: runner, environment });
  command("git", ["fsck", "--full", "--strict", "--no-dangling"], { cwd: runner, environment });

  const runtimeAsset = lock.assets.find((asset) => asset.name.endsWith("-runtime.tar.gz"));
  const artifactsAsset = lock.assets.find((asset) => asset.name.endsWith("-artifacts.tar.gz"));
  if (!runtimeAsset || !artifactsAsset) throw new Error("parent runtime or artifacts asset is missing");
  await copyTree(roots[runtimeAsset.name], runner);
  await copyTree(roots[artifactsAsset.name], runner);
  await copyTree(roots.worldHost, join(runner, ".praxis/reference-stack/extracted/worldHost", basename(roots.worldHost)));
  await copyTree(roots.worldCapabilities, join(runner, ".praxis/reference-stack/extracted/worldCapabilities", basename(roots.worldCapabilities)));

  const referenceStackLockSha256 = sha256(await readFile(join(runner, "conformance/praxis-v1/reference-stack.lock.json")));
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
    referenceStackLockSha256,
    deterministicReceiptSha256: lock.lifecycleReceipts.deterministic,
    retryReceiptSha256: lock.lifecycleReceipts.retry,
    replayReceiptSha256: lock.lifecycleReceipts.replay,
    measureReceiptSha256: lock.lifecycleReceipts.measure,
  };
  const candidatePath = join(runner, "conformance/praxis-v1/candidate.json");
  await writeFile(candidatePath, `${JSON.stringify(candidate, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return { runner, candidatePath };
}

export async function acquireParent({ root = defaultRoot } = {}) {
  const lock = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/parent.lock.json", import.meta.url), "utf8"));
  const child = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/child-stack.lock.json", import.meta.url), "utf8"));
  const downloads = join(root, "downloads"); const extracted = join(root, "extracted"); await mkdir(extracted, { recursive: true, mode: 0o700 });
  const roots = {};
  const sourceAsset = lock.assets.find((asset) => asset.name.endsWith("-source.tar.gz"));
  const runtimeAsset = lock.assets.find((asset) => asset.name.endsWith("-runtime.tar.gz"));
  if (!sourceAsset || !runtimeAsset) throw new Error("parent source or runtime asset is missing");
  for (const lockedAsset of lock.assets) {
    const asset = lockedAsset.name === sourceAsset.name ? { ...lockedAsset, allowedPaxComment: lock.release.candidateCommit } : lockedAsset;
    const acquired = await download(asset, downloads);
    if (asset.expectedRoot) roots[asset.name] = await extract(asset, acquired.bytes, extracted);
  }
  const runtimeRoot = roots[runtimeAsset.name];
  const referenceLock = JSON.parse(await readFile(join(runtimeRoot, "conformance/praxis-v1/reference-stack.lock.json"), "utf8"));
  for (const name of ["worldHost", "worldCapabilities"]) {
    const expected = child.archives[name]; const actual = referenceLock.archives[name];
    if (!actual || actual.url !== expected.url || actual.sha256 !== expected.sha256 || actual.root !== expected.root) throw new Error(`parent reference lock mismatch: ${name}`);
    const asset = { name: basename(expected.url), url: expected.url, sha256: expected.sha256, sizeBytes: name === "worldHost" ? 170017 : 1109607, maximumExpandedBytes: expected.maximumExpandedBytes, expectedRoot: expected.root };
    const acquired = await download(asset, downloads); roots[name] = await extract(asset, acquired.bytes, join(extracted, "reference"));
  }
  const materialized = await materializeRunner(root, lock, roots);
  roots.runner = materialized.runner;
  roots.candidate = materialized.candidatePath;
  return Object.freeze({ root, roots });
}

if (import.meta.main) {
  const result = await acquireParent(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ format: "poiesis-parent-acquisition/v1", root: result.root, roots: result.roots })}\n`);
}
