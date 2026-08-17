import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";

const utf8 = new TextDecoder("utf-8", { fatal: true });
const exactCheck = Object.freeze({ kind: "zig-build-check-v1", argv: ["build", "check", "--summary", "all"] });
const compiledLimits = Object.freeze({ maximumFileBytes: 16 * 1024, maximumListedFiles: 64, maximumChangedFiles: 4, maximumMutationOperations: 6 });
const checkTimeoutMs = 600_000;
const checkOutputBytes = 16 * 1024;

function exact(value, keys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const actual = Object.keys(value).sort(); const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new TypeError(`${label} has missing or unknown fields`);
  return value;
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

const sha256Bytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256Text = (value) => sha256Bytes(Buffer.from(value, "utf8"));

function validatePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || Buffer.byteLength(value) > 256) throw new TypeError(`${label} is outside the path bound`);
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.endsWith("/") || /^[A-Za-z]:/.test(value)) throw new TypeError(`${label} is not normalized`);
  if (value.split("/").some((part) => part === "" || part === "." || part === "..")) throw new TypeError(`${label} is not normalized`);
  return value;
}

function validatePrefix(value) {
  if (value === "") return value;
  if (typeof value !== "string" || Buffer.byteLength(value) > 256 || value.includes("//")) throw new TypeError("path_prefix is not normalized");
  const normalized = value.endsWith("/") ? value.slice(0, -1) : value;
  return validatePath(normalized, "path_prefix");
}

function sortedPaths(value, maximum, label) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} exceeds its bound`);
  const paths = value.map((item, index) => validatePath(item, `${label}[${index}]`));
  const sorted = [...paths].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (new Set(paths).size !== paths.length || paths.some((item, index) => item !== sorted[index])) throw new TypeError(`${label} must be unique and byte-sorted`);
  return paths;
}

export function admitWorkspacePolicy(value, { repository, baseRevision } = {}) {
  const policy = exact(value, ["format", "repository", "baseRevision", "readablePaths", "writablePaths", "check", "limits"], "workspace policy");
  if (policy.format !== "poiesis-workspace-policy/v1") throw new TypeError("workspace policy format mismatch");
  if (policy.repository !== repository) throw new TypeError("workspace policy repository mismatch");
  if (!/^[0-9a-f]{40}$/.test(policy.baseRevision) || policy.baseRevision !== baseRevision) throw new TypeError("workspace policy base revision mismatch");
  const readablePaths = sortedPaths(policy.readablePaths, 64, "readablePaths");
  const writablePaths = sortedPaths(policy.writablePaths, 4, "writablePaths");
  const readable = new Set(readablePaths);
  if (writablePaths.some((item) => !readable.has(item))) throw new TypeError("writablePaths must be a subset of readablePaths");
  const check = exact(policy.check, ["kind", "argv"], "check");
  if (check.kind !== exactCheck.kind || !Array.isArray(check.argv) || check.argv.length !== exactCheck.argv.length || check.argv.some((item, index) => item !== exactCheck.argv[index])) throw new TypeError("workspace policy check mismatch");
  const limits = exact(policy.limits, Object.keys(compiledLimits), "limits");
  for (const [name, maximum] of Object.entries(compiledLimits)) if (!Number.isInteger(limits[name]) || limits[name] <= 0 || limits[name] > maximum) throw new TypeError(`workspace policy ${name} exceeds compiled maximum`);
  if (limits.maximumListedFiles < readablePaths.length || limits.maximumChangedFiles < writablePaths.length) throw new TypeError("workspace policy path count exceeds limits");
  const admitted = { format: policy.format, repository, baseRevision, readablePaths, writablePaths, check: { kind: check.kind, argv: [...check.argv] }, limits: { ...limits } };
  return Object.freeze({ policy: Object.freeze(admitted), digest: sha256Text(canonical(admitted)) });
}

async function admittedFile(context, requested, writable) {
  validatePath(requested, "path");
  const admitted = new Set(writable ? context.policy.writablePaths : context.policy.readablePaths);
  if (!admitted.has(requested)) throw new Error(writable ? "path_not_writable" : "path_not_readable");
  const root = await realpath(context.workspaceRoot);
  if (root !== context.workspaceRootReal) throw new Error("workspace_root_changed");
  const full = resolvePath(root, requested); const rel = relative(root, full);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error("path_escapes_workspace");
  const info = await lstat(full);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new Error("path_not_ordinary_file");
  return { full, path: requested, info };
}

async function snapshot(context, requested) {
  const admitted = await admittedFile(context, requested, false);
  if (admitted.info.size > context.policy.limits.maximumFileBytes) throw new Error("file_too_large");
  const bytes = await readFile(admitted.full);
  if (bytes.length > context.policy.limits.maximumFileBytes) throw new Error("file_too_large");
  let contents; try { contents = utf8.decode(bytes); } catch { throw new Error("file_not_utf8"); }
  return { path: admitted.path, sha256: sha256Bytes(bytes), contents };
}

async function listRepository(context) {
  const writable = new Set(context.policy.writablePaths); const entries = [];
  for (const admittedPath of context.policy.readablePaths) { const file = await admittedFile(context, admittedPath, false); await snapshot(context, admittedPath); entries.push({ path: admittedPath, size_bytes: file.info.size, writable: writable.has(admittedPath) }); }
  return { entries, truncated: false };
}

function truncate(value, maximum) { const bytes = Buffer.from(value); if (bytes.length <= maximum) return value; let end = maximum; while (end > 0) { try { return utf8.decode(bytes.subarray(0, end)); } catch { end -= 1; } } return ""; }
async function search(context, payload) {
  if (!Number.isInteger(payload.assertion_index) || payload.assertion_index < 0 || payload.assertion_index > 255) throw new Error("assertion_index_not_admitted");
  if (typeof payload.query !== "string" || Buffer.byteLength(payload.query) === 0 || Buffer.byteLength(payload.query) > 256) throw new Error("search_query_not_admitted");
  const prefix = validatePrefix(payload.path_prefix); const hits = []; let truncated = false;
  for (const candidate of context.policy.readablePaths.filter((item) => prefix === "" || item === prefix || item.startsWith(`${prefix}/`))) {
    const document = await snapshot(context, candidate); const lines = document.contents.split("\n");
    for (let index = 0; index < lines.length; index += 1) if (lines[index].includes(payload.query)) { if (hits.length === 24) { truncated = true; break; } hits.push({ path: candidate, line: index + 1, excerpt: truncate(lines[index], 512) }); }
    if (truncated) break;
  }
  return { assertion_index: payload.assertion_index, query: payload.query, path_prefix: payload.path_prefix, hits, truncated };
}

async function runCheck(context) {
  if (!isAbsolute(context.zigExecutable)) throw new Error("zig_executable_not_absolute");
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(context.zigExecutable, exactCheck.argv, { cwd: context.workspaceRootReal, shell: false, stdio: ["ignore", "pipe", "pipe"], env: { HOME: context.temporaryHome, TMPDIR: context.temporaryHome, NO_COLOR: "1", ZIG_LOCAL_CACHE_DIR: join(context.temporaryHome, "zig-local"), ZIG_GLOBAL_CACHE_DIR: join(context.temporaryHome, "zig-global"), PATH: `${dirname(context.zigExecutable)}:/usr/bin:/bin` } });
    const chunks = []; let retained = 0; let truncated = false;
    const capture = (chunk) => { const bytes = Buffer.from(chunk); const available = Math.max(0, checkOutputBytes - retained); if (available) { chunks.push(bytes.subarray(0, available)); retained += Math.min(bytes.length, available); } if (bytes.length > available) truncated = true; };
    child.stdout.on("data", capture); child.stderr.on("data", capture);
    const timer = setTimeout(() => child.kill("SIGKILL"), checkTimeoutMs);
    child.once("error", (error) => { clearTimeout(timer); rejectPromise(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); const bytes = Buffer.concat(chunks); resolvePromise({ exit_code: Number.isInteger(code) ? code : -1, passed: code === 0 && signal === null, output: bytes.toString("utf8"), truncated: truncated || signal !== null }); });
  });
}

function digestPart(hasher, value) { const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value); const length = Buffer.alloc(4); length.writeUInt32LE(bytes.length); hasher.update(length); hasher.update(bytes); }
export function replacementProposalDigest(context, request) { const hash = createHash("sha256"); for (const value of ["poiesis.replace.proposal.v1", "replace", request.payload.path, request.payload.expected_sha256, request.payload.replacement, request.payload.rationale, context.applicationId, context.runId, context.policyDigest]) digestPart(hash, value); return hash.digest("hex"); }

async function approve(context, request, replacementSha256) {
  const approval = { format: "poiesis-approval/v1", applicationId: context.applicationId, runId: context.runId, requestId: request.requestId, policyDigest: context.policyDigest, path: request.payload.path, expectedSha256: request.payload.expected_sha256, replacementSha256, proposalDigest: replacementProposalDigest(context, request), approved: true };
  await mkdir(context.approvalRoot, { recursive: true, mode: 0o700 }); const file = join(context.approvalRoot, `${request.requestId}.json`); const encoded = `${canonical(approval)}\n`;
  try { await writeFile(file, encoded, { flag: "wx", mode: 0o600 }); } catch (error) { if (error?.code !== "EEXIST" || await readFile(file, "utf8") !== encoded) throw error; }
  context.approvalBindings ??= []; if (!context.approvalBindings.some((item) => item.requestId === request.requestId)) context.approvalBindings.push(approval);
}

async function replace(context, request) {
  const admitted = await admittedFile(context, request.payload.path, true); const before = await snapshot(context, admitted.path); const bytes = Buffer.from(request.payload.replacement);
  if (bytes.length > context.policy.limits.maximumFileBytes) return { outcome: "denied", value: { path: admitted.path, reason: "replacement_too_large" } };
  if (!/^[0-9a-f]{64}$/.test(request.payload.expected_sha256)) return { outcome: "denied", value: { path: admitted.path, reason: "expected_digest_invalid" } };
  const replacementSha256 = sha256Bytes(bytes); await approve(context, request, replacementSha256);
  if (before.sha256 === replacementSha256) return { outcome: "applied", value: { path: admitted.path, old_sha256: request.payload.expected_sha256, new_sha256: replacementSha256, already_applied: true, current: before } };
  if (before.sha256 !== request.payload.expected_sha256) return { outcome: "conflict", value: { path: admitted.path, expected_sha256: request.payload.expected_sha256, actual_sha256: before.sha256 } };
  const temporary = join(dirname(admitted.full), `.poiesis-${randomBytes(12).toString("hex")}.tmp`);
  try { const handle = await open(temporary, "wx", admitted.info.mode & 0o777); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } await rename(temporary, admitted.full); } finally { await rm(temporary, { force: true }).catch(() => {}); }
  const current = await snapshot(context, admitted.path); if (current.sha256 !== replacementSha256) throw new Error("replacement_digest_mismatch");
  return { outcome: "applied", value: { path: admitted.path, old_sha256: before.sha256, new_sha256: replacementSha256, already_applied: false, current } };
}

const outcome = (request, status, payload) => ({ requestId: request?.requestId ?? "unknown", status, payload });
export async function preflight(context, request) { try { if (!request || typeof request.requestId !== "string") return outcome(request, "rejected", { reason: "invalid_request" }); if (request.applicationId !== undefined && request.applicationId !== context.applicationId) return outcome(request, "rejected", { reason: "application_mismatch" }); if (context.repository !== context.policy.repository || context.baseRevision !== context.policy.baseRevision) return outcome(request, "rejected", { reason: "policy_context_mismatch" }); if (await realpath(context.workspaceRoot) !== context.workspaceRootReal) return outcome(request, "rejected", { reason: "workspace_root_changed" }); if (![context.temporaryHome, context.approvalRoot].every(isAbsolute)) return outcome(request, "rejected", { reason: "private_paths_not_absolute" }); return outcome(request, "ok", { admitted: true }); } catch (error) { return outcome(request, "rejected", { reason: String(error.message) }); } }
export async function resolve(context, request) { const admitted = await preflight(context, request); if (admitted.status !== "ok") return admitted; try { const operation = request.payload.operation; if (operation === "list") return outcome(request, "ok", await listRepository(context)); if (operation === "read") return outcome(request, "ok", await snapshot(context, request.payload.path)); if (operation === "search") return outcome(request, "ok", await search(context, request.payload)); if (operation === "check") { if (request.payload.suite !== "full") return outcome(request, "rejected", { reason: "check_suite_not_admitted" }); context.checkCount = (context.checkCount ?? 0) + 1; return outcome(request, "ok", await runCheck(context)); } if (operation === "replace") { const value = await replace(context, request); if (value.outcome === "applied" && !value.value.already_applied) context.mutationCount = (context.mutationCount ?? 0) + 1; return outcome(request, "ok", value); } return outcome(request, "rejected", { reason: "operation_not_admitted" }); } catch (error) { context.lastWorkspaceFailure = String(error.message).slice(0, 256); return outcome(request, "failed", { reason: context.lastWorkspaceFailure }); } }
export async function recover(_context, effectRecord) { return effectRecord?.recordedResolution ? structuredClone(effectRecord.recordedResolution) : { status: "failed", payload: { reason: "recorded_resolution_required" } }; }

export const _workspaceInternals = { canonical, sha256Text, validatePrefix, snapshot, listRepository, search, runCheck };
