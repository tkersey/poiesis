import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import * as workspaceAdapter from "../scaffold/runtime/workspace-adapter.mjs";
import * as openaiAdapter from "../scaffold/runtime/openai-adapter.mjs";
import { createPoiesisRouter } from "../scaffold/runtime/bindings.mjs";
import { decodeEffectPayload, decodeFinalResult } from "../scaffold/runtime/codecs.mjs";
import { verifyCurrent } from "./check-artifacts.mjs";

const repositoryRoot = resolve(new URL("..", import.meta.url).pathname);
const artifactsRoot = join(repositoryRoot, "zig-out/release-steward");
const stackRoot = join(repositoryRoot, ".poiesis/parent/extracted/reference");
const worldHostRoot = join(stackRoot, "world-host-v1.0.1-runtime/world-host-v1.0.1-runtime");
const worldCapabilitiesRoot = join(stackRoot, "world-capabilities-v2.3.2-deterministic/world-capabilities-v2.3.2-deterministic");
const receiptsRoot = join(repositoryRoot, "conformance/poiesis-v1/receipts");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const utf8 = new TextDecoder("utf-8", { fatal: true });
const modes = new Set(["deterministic", "retry", "replay", "measure", "live"]);
const liveRepositories = new Set(["tkersey/boundary", "tkersey/world", "tkersey/agent", "tkersey/praxis"]);

function command(executable, args, options = {}) {
  const result = Bun.spawnSync([executable, ...args], { cwd: options.cwd ?? repositoryRoot, env: options.env, stdout: "pipe", stderr: "pipe" });
  const stdout = result.stdout ? Buffer.from(result.stdout) : Buffer.alloc(0); const stderr = result.stderr ? Buffer.from(result.stderr) : Buffer.alloc(0);
  if (result.error || (!options.allowFailure && result.exitCode !== 0)) throw new Error(`${executable} ${args.join(" ")} failed\n${result.error ?? ""}${stdout}${stderr}`);
  return Object.freeze({ status: result.exitCode, stdout, stderr });
}

function parseArgs(argv) {
  const modeIndex = argv.indexOf("--mode");
  if (modeIndex < 0 || !modes.has(argv[modeIndex + 1])) throw new Error("--mode is required");
  const mode = argv[modeIndex + 1]; const rest = [...argv.slice(0, modeIndex), ...argv.slice(modeIndex + 2)];
  if (rest.length % 2 !== 0) throw new Error("child options must be flag/value pairs");
  const options = { mode };
  const names = {
    "--zig": "zigExecutable", "--receipt": "receipt", "--run-id": "runId", "--run-root": "runRoot",
    "--repository-root": "targetRoot", "--repository": "repository", "--base-revision": "baseRevision",
    "--task": "task", "--goal": "goal", "--policy": "policy", "--candidate": "candidate", "--store": "store",
  };
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index]; const value = rest[index + 1];
    if (!names[flag] || options[names[flag]] !== undefined) throw new Error(`invalid child option: ${flag}`);
    options[names[flag]] = value;
  }
  if (mode === "live") {
    for (const name of ["targetRoot", "repository", "baseRevision", "task", "goal", "policy", "zigExecutable", "candidate", "store", "receipt"]) if (!options[name]) throw new Error(`${name} is required for live mode`);
    for (const name of ["targetRoot", "task", "goal", "policy", "zigExecutable", "candidate", "store"]) if (!isAbsolute(options[name])) throw new Error(`${name} must be absolute`);
    if (!/^[0-9a-f]{40}$/.test(options.baseRevision)) throw new Error("baseRevision must be forty lowercase hexadecimal characters");
  }
  for (const name of ["targetRoot", "task", "goal", "policy", "zigExecutable", "candidate", "store", "receipt", "runRoot"]) if (options[name]) options[name] = resolve(options[name]);
  return Object.freeze(options);
}

function generatedState() {
  const text = Bun.file(join(repositoryRoot, "test/generated_semantics.zig"));
  return text.text().then((value) => /pub const generated\s*=\s*true\s*;/.test(value));
}

function fixedEnvironment(home, zigExecutable) {
  return { HOME: home, TMPDIR: home, NO_COLOR: "1", PATH: `${dirname(process.execPath)}:${dirname(zigExecutable)}:/usr/bin:/bin`, ZIG_LOCAL_CACHE_DIR: join(home, "zig-local"), ZIG_GLOBAL_CACHE_DIR: join(home, "zig-global") };
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

async function writeReceipt(path, value) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  try { await writeFile(path, bytes, { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error?.code !== "EEXIST" || !Buffer.from(await readFile(path)).equals(bytes)) throw error; }
}

async function stubProof(mode, options) {
  const artifact = await verifyCurrent({ expect: "stub" });
  const receipt = Object.freeze({ poiesis_format: 1, mode, stage: "stub", generated: false, proof_applicable: false, application_id: artifact.applicationId, application_wasm_sha256: artifact.wasmSha256, credential_free: true });
  await writeReceipt(options.receipt, receipt);
  return Object.freeze({ receipt, stub: true });
}

async function copyTree(source, destination) {
  const status = await lstat(source);
  if (status.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: status.mode & 0o777 });
    for (const entry of (await readdir(source)).sort()) await copyTree(join(source, entry), join(destination, entry));
  } else {
    assert.equal(status.isFile(), true); assert.equal(status.isSymbolicLink(), false); assert.equal(status.nlink, 1);
    await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); await chmod(destination, status.mode & 0o777);
  }
}

async function prepareFixture(runRoot) {
  const fixtureRoot = join(repositoryRoot, "fixtures/release-steward-v1");
  const source = join(runRoot, "source"); const worktree = join(runRoot, "worktree");
  await copyTree(join(fixtureRoot, "initial"), source);
  command("git", ["init", "--quiet"], { cwd: source }); command("git", ["add", "--all"], { cwd: source });
  command("git", ["-c", "user.name=Poiesis Fixture", "-c", "user.email=poiesis@example.invalid", "commit", "--quiet", "--message", "fixture baseline"], { cwd: source, env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } });
  const baseRevision = command("git", ["rev-parse", "HEAD"], { cwd: source }).stdout.toString("utf8").trim();
  command("git", ["worktree", "add", "--quiet", "--detach", worktree, baseRevision], { cwd: source });
  return Object.freeze({ fixtureRoot, source, worktree, baseRevision });
}

async function listedFiles(root, prefix = "") {
  const result = [];
  for (const name of (await readdir(join(root, prefix), { withFileTypes: true })).sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)))) {
    const path = prefix ? `${prefix}/${name.name}` : name.name;
    if (name.isDirectory()) result.push(...await listedFiles(root, path));
    else { assert.equal(name.isFile(), true, `fixture path is not an ordinary file: ${path}`); result.push(path); }
  }
  return result;
}

async function verifyFixtureExpected(fixtureRoot, worktree, changedPaths) {
  const initialRoot = join(fixtureRoot, "initial"); const expectedRoot = join(fixtureRoot, "expected");
  const initialFiles = await listedFiles(initialRoot); const expectedFiles = await listedFiles(expectedRoot);
  assert.deepEqual(expectedFiles, initialFiles, "fixture expected tree changes topology");
  const expectedChanges = [];
  for (const path of expectedFiles) {
    const [initial, expected, actual] = await Promise.all([readFile(join(initialRoot, path)), readFile(join(expectedRoot, path)), readFile(join(worktree, path))]);
    assert.ok(actual.equals(expected), `fixture output mismatch: ${path}`);
    if (!initial.equals(expected)) expectedChanges.push(path);
  }
  assert.deepEqual(changedPaths, expectedChanges, "fixture changed-path set differs from expected tree");
  return Object.freeze({ fileCount: expectedFiles.length, changedPaths: expectedChanges });
}

function operationForInterface(label) {
  return ({ "repo.list.v2": "list", "repo.read.v2": "read", "repo.release-search.v1": "search", "repo.check.v1": "check", "repo.replace.approved.v2": "replace" })[label] ?? null;
}

export function analyzeInterfaceSequence(events, finalMutationCount, assertionCount) {
  let mutations = 0; let lastCheckMutation = -1; let baselineCheck = false; const assertionMutations = new Map();
  for (const event of events) {
    if (event.interfaceLabel === "repo.check.v1") { lastCheckMutation = mutations; baselineCheck = true; }
    if (event.interfaceLabel === "repo.replace.approved.v2" && event.applied) {
      assert.equal(lastCheckMutation, mutations, "replacement lacked a fresh passing check"); mutations += 1;
    }
    if (event.interfaceLabel === "repo.release-search.v1") assertionMutations.set(event.assertionIndex, mutations);
  }
  assert.equal(baselineCheck, true); assert.equal(mutations, finalMutationCount); assert.equal(lastCheckMutation, mutations, "terminal check is stale");
  assert.equal(assertionMutations.size, assertionCount, "not every assertion was evaluated");
  for (const observedMutation of assertionMutations.values()) assert.equal(observedMutation, mutations, "assertion evidence is stale");
  return Object.freeze({ baselineCheck, mutations, lastCheckMutation, assertions: assertionMutations.size });
}

async function runtimeInputs(wasmPath = null) {
  const [bindingManifest, decisionContract, wasmBytes] = await Promise.all([
    Bun.file(join(artifactsRoot, "release-steward.binding-manifest.json")).json(),
    Bun.file(join(artifactsRoot, "release-steward.decision-contract.json")).json(),
    readFile(wasmPath ?? join(artifactsRoot, "release-steward.world.wasm")),
  ]);
  return Object.freeze({ bindingManifest, decisionContract, wasmBytes });
}

async function initialArgs({ task, goal, repository, baseRevision }) {
  return command(join(repositoryRoot, "zig-out/bin/poiesis-initial-args"), ["--task-file", task, "--goal-file", goal, "--repository", repository, "--base-revision", baseRevision]).stdout;
}

async function hostModule() {
  return import(pathToFileURL(join(worldHostRoot, "src/v1/index.mjs")).href);
}

async function execute({ runId, branchId = "main", wasmBytes, bindingManifest, decisionContract, modelAdapter, workspace, policy, zigExecutable, task, goalPath, stores = null, callbacks = {} }) {
  const host = await hostModule(); const temporaryHome = join(workspace.runRoot, "home"); const approvalRoot = join(workspace.runRoot, "approvals");
  await mkdir(temporaryHome, { recursive: true, mode: 0o700 });
  const context = { applicationId: bindingManifest.applicationId, runId, workspaceRoot: workspace.worktree, workspaceRootReal: await realpath(workspace.worktree), repository: policy.policy.repository, baseRevision: workspace.baseRevision, policy: policy.policy, policyDigest: policy.digest, zigExecutable, zigVersion: "0.16.0", temporaryHome, approvalRoot, decisionContract, decisionContractDigest: bindingManifest.decisionContractDigest, model: process.env.OPENAI_MODEL, allowedModels: process.env.OPENAI_MODEL ? [process.env.OPENAI_MODEL] : [], secrets: process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}, manualFileEdits: 0, unapprovedWrites: 0 };
  const router = await createPoiesisRouter({ worldCapabilitiesRoot, bindingManifest, workspaceAdapter, modelAdapter, modelBindingId: callbacks.modelBindingId ?? "poiesis-fixture-model.v1" });
  const blockStore = stores?.blockStore ?? new host.MemoryBlockStore(); const headStore = stores?.headStore ?? new host.MemoryBranchHeadStore(); const effectJournal = stores?.effectJournal ?? new host.MemoryEffectJournalV1({ blockStore });
  let workerCount = 0;
  const controller = await host.RunControllerV1.create({ wasmBytes, blockStore, headStore, effectJournal, workerFactory: () => { workerCount += 1; return new host.ApplicationWorker({ maximumMemoryBytes: 256 * 1024 * 1024 }); }, preflight: async (manifest) => ({ blockers: Buffer.from(manifest.applicationId).toString("hex") === bindingManifest.applicationId ? [] : ["application_id_mismatch"] }), faultInjector: callbacks.faultInjector ?? (async () => {}) });
  const goalDocument = await Bun.file(goalPath).json();
  const args = await initialArgs({ task, goal: goalPath, repository: policy.policy.repository, baseRevision: workspace.baseRevision });
  const trace = { frames: [], results: [], events: [], providerClaims: [], stepNanoseconds: [] }; callbacks.onEnvironment?.({ controller, context, workspace, runId, branchId, args, host, bindingManifest, wasmBytes });
  let started = process.hrtime.bigint(); let transition = await controller.initialize(runId, branchId, { initialArgsBytes: args }); trace.stepNanoseconds.push(Number(process.hrtime.bigint() - started));
  const genesisFrameId = Buffer.from(transition.frame.frameId).toString("hex"); let identicalYields = 0; let previousYield = null;
  while (true) {
    assert.equal(transition.status, "advanced"); const frame = transition.frame; trace.frames.push(Buffer.from(transition.frameBytes).toString("base64"));
    if (frame.status === host.FrameStatus.completed) break;
    if (frame.status === host.FrameStatus.failed || frame.status === host.FrameStatus.cancelled) throw new Error(`child World terminal status ${frame.status}`);
    if (frame.status === host.FrameStatus.yieldedFuel) {
      const digest = sha256(frame.stateBytes); identicalYields = digest === previousYield ? identicalYields + 1 : 1; previousYield = digest; if (identicalYields >= 10) throw new Error("fuel stall");
      transition = await controller.advance(runId, branchId); continue;
    }
    assert.equal(frame.status, host.FrameStatus.needsEffect);
    const interfaceEntry = bindingManifest.interfaces.find((entry) => entry.interfaceId === Buffer.from(frame.pendingEffect.interfaceId).toString("hex")); assert.ok(interfaceEntry);
    const operation = operationForInterface(interfaceEntry.interfaceLabel); const payload = operation ? decodeEffectPayload(operation, frame.pendingEffect.payloadBytes) : null;
    const beforeMutation = context.mutationCount ?? 0;
    if (operation) context.workspaceAdapterInvocations = (context.workspaceAdapterInvocations ?? 0) + 1;
    const resolution = await router.resolve(context, frame.pendingEffect.encodedBytes);
    if (interfaceEntry.interfaceLabel === "model.decide.v1" && resolution.result.hostClaims.length > 0) trace.providerClaims.push(JSON.parse(utf8.decode(resolution.result.hostClaims)));
    const metadata = { handlerId: resolution.handlerIdentity, handlerConfigurationId: resolution.handlerConfigurationIdentity, recoveryClass: resolution.recoveryClass };
    const event = { interfaceLabel: interfaceEntry.interfaceLabel, assertionIndex: payload?.assertion_index ?? null, applied: operation === "replace" && (context.mutationCount ?? 0) > beforeMutation };
    trace.events.push(event); trace.results.push({ encodedBytes: Buffer.from(resolution.result.encodedBytes).toString("base64"), metadata, interfaceLabel: interfaceEntry.interfaceLabel });
    await callbacks.beforeEffectAdvance?.({ transition, resolution, interfaceEntry, metadata, context, event });
    started = process.hrtime.bigint(); transition = await controller.advance(runId, branchId, { effectResult: resolution.result, effectMetadata: metadata }); trace.stepNanoseconds.push(Number(process.hrtime.bigint() - started));
  }
  const terminal = transition.frame; const finalResult = decodeFinalResult(terminal.finalResultBytes);
  const changedPaths = command("git", ["diff", "--name-only", workspace.baseRevision, "--"], { cwd: workspace.worktree }).stdout.toString("utf8").trim().split("\n").filter(Boolean);
  assert.deepEqual(finalResult.changed_files, changedPaths); assert.equal(finalResult.mutation_count, context.mutationCount); assert.equal(finalResult.checks_passed, true); assert.equal(finalResult.target_version, goalDocument.target_version); assert.equal(finalResult.current_version, goalDocument.current_version); assert.equal(finalResult.assertions_satisfied, goalDocument.assertions.length);
  analyzeInterfaceSequence(trace.events, finalResult.mutation_count, goalDocument.assertions.length);
  const diff = command("git", ["diff", "--binary", "--no-ext-diff", "--full-index", workspace.baseRevision, "--", ...changedPaths], { cwd: workspace.worktree }).stdout;
  const terminalFileDigests = Object.fromEntries(await Promise.all(changedPaths.map(async (path) => [path, sha256(await readFile(join(workspace.worktree, path)))])));
  trace.measurements = { applicationWasmBytes: wasmBytes.length, peakFrameBytes: Math.max(...trace.frames.map((value) => Buffer.from(value, "base64").length)), peakMachineStateBytes: Math.max(...trace.frames.map((value) => host.decodeFrame(Buffer.from(value, "base64"), controller.manifest.limits).stateBytes.length)), stepCount: trace.frames.length };
  return Object.freeze({ host, controller, context, trace, finalResult, changedPaths, diffSha256: sha256(diff), terminalFileDigests, genesisFrameId, terminalFrameId: Buffer.from(terminal.frameId).toString("hex"), workerCount, args, workspace, bindingManifest, wasmBytes });
}

async function deterministicOptions(options, mode) {
  const runId = options.runId ?? `poiesis-v1-${mode}`; const runRoot = options.runRoot ?? join(repositoryRoot, ".poiesis/child-runs", runId);
  await rm(runRoot, { recursive: true, force: true }); await mkdir(runRoot, { recursive: true, mode: 0o700 });
  const prepared = { ...await prepareFixture(runRoot), runRoot };
  const rawPolicy = await Bun.file(join(prepared.fixtureRoot, "workspace-policy.json")).json(); rawPolicy.baseRevision = prepared.baseRevision;
  const policy = workspaceAdapter.admitWorkspacePolicy(rawPolicy, { repository: rawPolicy.repository, baseRevision: prepared.baseRevision });
  const zigExecutable = options.zigExecutable ?? command("which", ["zig"]).stdout.toString("utf8").trim(); assert.equal(command(zigExecutable, ["version"]).stdout.toString("utf8").trim(), "0.16.0");
  const home = join(runRoot, "preflight-home"); await mkdir(home, { recursive: true }); assert.equal(command(zigExecutable, ["build", "check", "--summary", "all"], { cwd: prepared.worktree, env: fixedEnvironment(home, zigExecutable) }).status, 0);
  const runtime = await runtimeInputs(options.wasmPath);
  const fixture = await import(pathToFileURL(join(repositoryRoot, "tools/fixture-model-adapter.mjs")).href);
  const modelAdapter = fixture.createFixtureModelAdapter({ applicationId: runtime.bindingManifest.applicationId, policyDigest: policy.digest, decisionContractDigest: runtime.bindingManifest.decisionContractDigest });
  return { runId, runRoot, prepared, policy, zigExecutable, runtime, modelAdapter };
}

async function runDeterministic(options = {}, callbacks = {}) {
  const prepared = await deterministicOptions(options, "deterministic");
  const execution = await execute({ runId: prepared.runId, wasmBytes: prepared.runtime.wasmBytes, bindingManifest: prepared.runtime.bindingManifest, decisionContract: prepared.runtime.decisionContract, modelAdapter: prepared.modelAdapter, workspace: { ...prepared.prepared, runRoot: prepared.runRoot }, policy: prepared.policy, zigExecutable: prepared.zigExecutable, task: join(prepared.prepared.fixtureRoot, "task.md"), goalPath: join(prepared.prepared.fixtureRoot, "goal.json"), callbacks });
  await verifyFixtureExpected(prepared.prepared.fixtureRoot, execution.workspace.worktree, execution.changedPaths);
  const receipt = { poiesis_format: 1, mode: "deterministic", application_id: execution.bindingManifest.applicationId, application_wasm_sha256: sha256(execution.wasmBytes), base_revision: execution.workspace.baseRevision, genesis_frame_id: execution.genesisFrameId, terminal_frame_id: execution.terminalFrameId, external_effect_count: execution.trace.events.length, model_effect_count: execution.trace.events.filter((event) => event.interfaceLabel === "model.decide.v1").length, non_model_effect_count: execution.trace.events.filter((event) => event.interfaceLabel !== "model.decide.v1").length, check_count: execution.context.checkCount ?? 0, mutation_count: execution.context.mutationCount ?? 0, changed_paths: execution.changedPaths, final_diff_sha256: execution.diffSha256, typed_final_result: true, expected_fixture_output: true, fresh_worker_per_step: execution.workerCount === execution.trace.frames.length + 1, manual_file_edits: 0, unapproved_writes: 0 };
  assert.ok(receipt.mutation_count >= 2 && receipt.mutation_count <= 6); assert.ok(receipt.changed_paths.length >= 2 && receipt.changed_paths.length <= 4); assert.equal(receipt.fresh_worker_per_step, true);
  await writeFile(join(prepared.runRoot, "trace.json"), `${JSON.stringify({ ...execution.trace, receipt, finalResult: execution.finalResult, diffSha256: execution.diffSha256, terminalFileDigests: execution.terminalFileDigests }, null, 2)}\n`, { mode: 0o600 });
  await writeReceipt(options.receipt ?? join(receiptsRoot, "child.deterministic.json"), receipt);
  return { ...execution, receipt, runRoot: prepared.runRoot };
}

async function proveRetry(options) {
  const fault = { armed: false, childBytes: null }; let environment; let parentBytes; let invocations; let mutations; let interrupted = false;
  try {
    await runDeterministic({ ...options, receipt: join(options.runRoot ?? join(repositoryRoot, ".poiesis/child-runs/retry"), "unused.json") }, { onEnvironment: (value) => { environment = value; }, beforeEffectAdvance: async ({ transition, event, context }) => { if (event.interfaceLabel === "repo.replace.approved.v2" && event.applied && (context.mutationCount ?? 0) === 1) { fault.armed = true; parentBytes = Buffer.from(transition.frameBytes); invocations = context.workspaceAdapterInvocations; mutations = context.mutationCount; } }, faultInjector: async (phase, details) => { if (fault.armed && phase === "after-world-step") { fault.armed = false; fault.childBytes = Buffer.from(details.output.frameBytes); throw new Error("simulated_lost_output"); } } });
  } catch (error) { interrupted = error?.message === "simulated_lost_output"; if (!interrupted) throw error; }
  assert.ok(interrupted && environment && fault.childBytes && parentBytes);
  const retained = await environment.controller.advance(environment.runId, environment.branchId); assert.ok(Buffer.from(retained.frameBytes).equals(fault.childBytes)); assert.equal(environment.context.workspaceAdapterInvocations, invocations); assert.equal(environment.context.mutationCount, mutations);
  const receipt = { poiesis_format: 1, mode: "retry", deterministic_retry: true, retry_content_writes: 1, retry_child_frame_byte_identical: true, retry_fresh_adapter_invocations: 0 };
  await writeReceipt(options.receipt ?? join(receiptsRoot, "child.retry.json"), receipt); return { receipt };
}

async function proveReplay(options) {
  const recorded = await runDeterministic({ ...options, receipt: options.receipt ? `${options.receipt}.recorded` : join(repositoryRoot, ".poiesis/child-runs/replay-recorded.json") });
  const host = recorded.host; let workers = 0; const controller = await host.RunControllerV1.create({ wasmBytes: recorded.wasmBytes, blockStore: new host.MemoryBlockStore(), headStore: new host.MemoryBranchHeadStore(), workerFactory: () => { workers += 1; return new host.ApplicationWorker({ maximumMemoryBytes: 256 * 1024 * 1024 }); }, preflight: async () => ({ blockers: [] }) });
  let current = await controller.initialize("replay", "main", { initialArgsBytes: recorded.args }); let resultIndex = 0; let steps = 1;
  while (current.frame.status !== host.FrameStatus.completed) {
    if (current.frame.status === host.FrameStatus.yieldedFuel) current = await controller.advance("replay", "main");
    else { const retained = recorded.trace.results[resultIndex++]; assert.ok(retained); current = await controller.advance("replay", "main", { effectResult: Buffer.from(retained.encodedBytes, "base64"), effectMetadata: retained.metadata }); }
    steps += 1;
  }
  assert.equal(resultIndex, recorded.trace.results.length); assert.ok(Buffer.from(current.frameBytes).equals(Buffer.from(recorded.trace.frames.at(-1), "base64"))); assert.deepEqual(decodeFinalResult(current.frame.finalResultBytes), recorded.finalResult);
  const receipt = { poiesis_format: 1, mode: "replay", replay_fresh_effect_count: 0, replay_terminal_frame_byte_identical: true, replay_terminal_result_equal: true, replay_diff_sha256: recorded.diffSha256, fresh_worker_per_step: workers === steps + 1 };
  await writeReceipt(options.receipt ?? join(receiptsRoot, "child.replay.json"), receipt); return { receipt };
}

export function measurementGates(measurements) {
  return Object.freeze({ applicationWasm: measurements.applicationWasmBytes <= 6 * 1024 * 1024, applicationState: measurements.applicationStateLimitBytes <= 512 * 1024, peakFrame: measurements.peakFrameBytes <= 384 * 1024, peakMachineState: measurements.peakMachineStateBytes <= 320 * 1024, wasmStack: measurements.wasmStackBytes <= 128 * 1024 * 1024, wasmMemory: measurements.wasmMemoryBytes <= 256 * 1024 * 1024, externalEffects: measurements.externalEffectCount <= 95, modelEffects: measurements.modelEffectCount <= 48, mutations: measurements.mutationCount >= 1 && measurements.mutationCount <= 6, changedFiles: measurements.changedFileCount >= 1 && measurements.changedFileCount <= 4 });
}

async function proveMeasure(options) {
  const proof = await runDeterministic({ ...options, receipt: options.receipt ? `${options.receipt}.deterministic` : join(repositoryRoot, ".poiesis/child-runs/measure-deterministic.json") });
  const measurements = { ...proof.trace.measurements, applicationStateLimitBytes: 512 * 1024, wasmStackBytes: 128 * 1024 * 1024, wasmMemoryBytes: 256 * 1024 * 1024, externalEffectCount: proof.receipt.external_effect_count, modelEffectCount: proof.receipt.model_effect_count, mutationCount: proof.receipt.mutation_count, changedFileCount: proof.receipt.changed_paths.length };
  const gates = measurementGates(measurements); assert.ok(Object.values(gates).every(Boolean)); const receipt = { poiesis_format: 1, mode: "measure", application_id: proof.bindingManifest.applicationId, application_wasm_sha256: sha256(proof.wasmBytes), measurements, gates };
  await writeReceipt(options.receipt ?? join(receiptsRoot, "child.measure.json"), receipt); return { receipt };
}

async function runLive(options) {
  if (!process.env.OPENAI_API_KEY || !process.env.OPENAI_MODEL) throw new Error("OPENAI_API_KEY and OPENAI_MODEL are required");
  if (!liveRepositories.has(options.repository)) throw new Error("live repository is outside the v1 profile");
  assert.equal(options.receipt, join(repositoryRoot, "conformance/poiesis-v1/receipts/child.live.redacted.json"), "live receipt path mismatch");
  const candidate = await Bun.file(options.candidate).json(); assert.equal(candidate.format, "poiesis-child-candidate/v1");
  const runtime = await runtimeInputs(); assert.equal(candidate.application_id, runtime.bindingManifest.applicationId); assert.equal(candidate.application_wasm_sha256, sha256(runtime.wasmBytes));
  assert.equal(candidate.decision_contract_digest, runtime.bindingManifest.decisionContractDigest);
  assert.equal(candidate.binding_manifest_sha256, sha256(await readFile(join(artifactsRoot, "release-steward.binding-manifest.json"))));
  assert.equal(candidate.codec_module_sha256, sha256(await readFile(join(repositoryRoot, "scaffold/runtime/codecs.mjs"))));
  assert.equal(candidate.workspace_adapter_sha256, sha256(await readFile(join(repositoryRoot, "scaffold/runtime/workspace-adapter.mjs"))));
  assert.equal(candidate.openai_adapter_sha256, sha256(await readFile(join(repositoryRoot, "scaffold/runtime/openai-adapter.mjs"))));
  assert.equal(candidate.child_stack_lock_sha256, sha256(await readFile(join(repositoryRoot, "conformance/poiesis-v1/child-stack.lock.json"))));
  const sourceRoot = await realpath(command("git", ["rev-parse", "--show-toplevel"], { cwd: options.targetRoot }).stdout.toString("utf8").trim()); assert.equal(sourceRoot, await realpath(options.targetRoot));
  if (inside(sourceRoot, options.store) || inside(repositoryRoot, options.store)) throw new Error("live store must be outside source repositories");
  command("git", ["cat-file", "-e", `${options.baseRevision}^{commit}`], { cwd: sourceRoot });
  await mkdir(options.store, { recursive: true, mode: 0o700 });
  const runId = `child-live-${randomUUID()}`; const runRoot = join(options.store, "runs", runId); await mkdir(runRoot, { recursive: false, mode: 0o700 }); const worktree = join(runRoot, "worktree"); command("git", ["worktree", "add", "--quiet", "--detach", worktree, options.baseRevision], { cwd: sourceRoot }); assert.equal(command("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: worktree }).stdout.length, 0);
  const rawPolicy = await Bun.file(options.policy).json(); const policy = workspaceAdapter.admitWorkspacePolicy(rawPolicy, { repository: options.repository, baseRevision: options.baseRevision }); const goal = await Bun.file(options.goal).json(); assert.equal(goal.format, "poiesis-goal/v1"); assert.ok(Array.isArray(goal.assertions) && goal.assertions.length >= 1 && goal.assertions.length <= 8);
  const preflightHome = join(runRoot, "preflight-home"); await mkdir(preflightHome); assert.equal(command(options.zigExecutable, ["build", "check", "--summary", "all"], { cwd: worktree, env: fixedEnvironment(preflightHome, options.zigExecutable) }).status, 0);
  const host = await hostModule(); const storeRoot = join(runRoot, "runtime-store"); await mkdir(storeRoot); const blockStore = new host.DirectoryBlockStore(storeRoot); const headStore = new host.DirectoryBranchHeadStore(storeRoot, { blockStore }); const effectJournal = new host.DirectoryEffectJournalV1({ root: storeRoot, blockStore });
  const execution = await execute({ runId, wasmBytes: runtime.wasmBytes, bindingManifest: runtime.bindingManifest, decisionContract: runtime.decisionContract, modelAdapter: openaiAdapter, workspace: { worktree, baseRevision: options.baseRevision, runRoot }, policy, zigExecutable: options.zigExecutable, task: options.task, goalPath: options.goal, stores: { blockStore, headStore, effectJournal }, callbacks: { modelBindingId: "poiesis-openai.v1" } });
  const claims = execution.trace.providerClaims;
  const receipt = { poiesis_format: 1, mode: "child-live", child_candidate_sha256: sha256(await readFile(options.candidate)), child_source_commit: candidate.source_commit, application_id: candidate.application_id, application_wasm_sha256: candidate.application_wasm_sha256, repository: options.repository, base_revision: options.baseRevision, task_sha256: sha256(await readFile(options.task)), goal_sha256: sha256(await readFile(options.goal)), policy_sha256: policy.digest, genesis_frame_id: execution.genesisFrameId, terminal_frame_id: execution.terminalFrameId, terminal_status: "completed", external_effect_count: execution.trace.events.length, model_effect_count: execution.trace.events.filter((event) => event.interfaceLabel === "model.decide.v1").length, non_model_effect_count: execution.trace.events.filter((event) => event.interfaceLabel !== "model.decide.v1").length, check_count: execution.context.checkCount ?? 0, mutation_count: execution.context.mutationCount ?? 0, unique_changed_file_count: execution.changedPaths.length, changed_paths: execution.changedPaths, assertion_count: goal.assertions.length, assertions_satisfied: execution.finalResult.assertions_satisfied, ordered_interfaces: execution.trace.events.map((event) => event.interfaceLabel), approval_bindings: execution.context.approvalBindings ?? [], final_diff_sha256: execution.diffSha256, typed_final_result: true, final_check_passed: true, independent_verifier_passed: false, fresh_worker_per_step: execution.workerCount === execution.trace.frames.length + 1, manual_file_edits: 0, unapproved_writes: 0, openai_responses_api: true, openai_tools_count: 0, openai_store: false, openai_api_key_recorded: false, raw_prompt_recorded: false, raw_repository_content_recorded: false, raw_model_output_recorded: false, provider_returned_models: [...new Set(claims.map((claim) => claim.returnedModel))], provider_response_id_digests: claims.map((claim) => claim.responseIdSha256), input_tokens: claims.reduce((sum, claim) => sum + claim.inputTokens, 0), output_tokens: claims.reduce((sum, claim) => sum + claim.outputTokens, 0), total_tokens: claims.reduce((sum, claim) => sum + claim.totalTokens, 0), private_evidence_digest: sha256(Buffer.from(JSON.stringify(execution.trace))), terminal_file_digests: execution.terminalFileDigests };
  await writeReceipt(options.receipt, receipt); return { receipt, execution, worktree, runRoot };
}

export async function runChild(options) {
  if (!await generatedState()) {
    if (options.mode === "live") throw new Error("live child execution requires generated semantics");
    return stubProof(options.mode, options);
  }
  if (options.mode === "deterministic") return runDeterministic(options);
  if (options.mode === "retry") return proveRetry(options);
  if (options.mode === "replay") return proveReplay(options);
  if (options.mode === "measure") return proveMeasure(options);
  return runLive(options);
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2)); const result = await runChild(options);
  process.stdout.write(`${JSON.stringify({ format: "poiesis-child-run-result/v1", mode: options.mode, stub: result.stub ?? false, receipt: result.receipt })}\n`);
}

export const _childRunnerInternals = Object.freeze({ analyzeInterfaceSequence, parseArgs });
