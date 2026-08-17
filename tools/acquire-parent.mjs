import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

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

export async function acquireParent({ root = defaultRoot } = {}) {
  const lock = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/parent.lock.json", import.meta.url), "utf8"));
  const child = JSON.parse(await readFile(new URL("../conformance/poiesis-v1/child-stack.lock.json", import.meta.url), "utf8"));
  const downloads = join(root, "downloads"); const extracted = join(root, "extracted"); await mkdir(extracted, { recursive: true, mode: 0o700 });
  const roots = {};
  for (const lockedAsset of lock.assets) {
    const asset = lockedAsset.name === "praxis-v1.0.0-source.tar.gz" ? { ...lockedAsset, allowedPaxComment: lock.release.candidateCommit } : lockedAsset;
    const acquired = await download(asset, downloads);
    if (asset.expectedRoot) roots[asset.name] = await extract(asset, acquired.bytes, extracted);
  }
  const runtimeRoot = roots["praxis-v1.0.0-runtime.tar.gz"];
  const referenceLock = JSON.parse(await readFile(join(runtimeRoot, "conformance/praxis-v1/reference-stack.lock.json"), "utf8"));
  for (const name of ["worldHost", "worldCapabilities"]) {
    const expected = child.archives[name]; const actual = referenceLock.archives[name];
    if (!actual || actual.url !== expected.url || actual.sha256 !== expected.sha256 || actual.root !== expected.root) throw new Error(`parent reference lock mismatch: ${name}`);
    const asset = { name: basename(expected.url), url: expected.url, sha256: expected.sha256, sizeBytes: name === "worldHost" ? 170017 : 1109607, maximumExpandedBytes: expected.maximumExpandedBytes, expectedRoot: expected.root };
    const acquired = await download(asset, downloads); roots[name] = await extract(asset, acquired.bytes, join(extracted, "reference"));
  }
  return Object.freeze({ root, roots });
}

if (import.meta.main) {
  const result = await acquireParent(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({ format: "poiesis-parent-acquisition/v1", root: result.root, roots: result.roots })}\n`);
}
