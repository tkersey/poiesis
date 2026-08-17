import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPoiesisBindings, createPoiesisRouter } from "../runtime/bindings.mjs";
import { decodeAction, decodeEffectResult, encodeDecisionTurn, encodeEffectPayload } from "../runtime/codecs.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });
const digest = (domain, value) => createHash("sha256").update(domain).update(Buffer.from([0])).update(value).digest("hex");
const labels = { decide: "model.decide.v1", list: "repo.list.v2", read: "repo.read.v2", search: "repo.release-search.v1", check: "repo.check.v1", replace: "repo.replace.approved.v2" };

async function capabilityRoot() {
  const root = await mkdtemp(join(tmpdir(), "poiesis-capabilities-")); roots.push(root);
  await mkdir(join(root, "src/v1"), { recursive: true });
  await writeFile(join(root, "src/v1/protocol.mjs"), `import { createHash } from "node:crypto";\nexport function effectInterfaceId(label) { return createHash("sha256").update("world.effect-interface.v1").update(Buffer.from([0])).update(label).digest(); }\n`);
  await writeFile(join(root, "src/v1/index.mjs"), `export class CapabilityRouterV1 { constructor({ bindings }) { this.bindings = bindings; } }\n`);
  return root;
}

function manifest() {
  return {
    format: "poiesis-binding-manifest/v1",
    applicationId: "a".repeat(64),
    applicationName: "release-steward",
    applicationVersion: "1.0.0",
    decisionContractDigest: "b".repeat(64),
    interfaces: Object.entries(labels).map(([operation, interfaceLabel], index) => ({
      operation,
      siteIdentity: interfaceLabel,
      interfaceLabel,
      interfaceId: digest("world.effect-interface.v1", interfaceLabel),
      payloadSchemaId: (index + 1).toString(16).padStart(64, "0"),
      resultSchemaId: (index + 17).toString(16).padStart(64, "0"),
      authorityRequirements: String(index + 1),
      maximumResultBytes: 65536,
    })),
  };
}

const adapter = Object.freeze({ preflight: async () => ({ status: "ok" }), resolve: async () => ({ status: "ok" }) });
const context = { runId: "run-1", model: "gpt-test", workspaceRootReal: "/workspace", repository: "tkersey/fixture", baseRevision: "0".repeat(40), policyDigest: "c".repeat(64), zigExecutable: "/opt/zig", zigVersion: "0.16.0" };

describe("canonical Poiesis bindings", () => {
  test("covers the exact generated interfaces and codec directions", async () => {
    const bindings = await createPoiesisBindings({ worldCapabilitiesRoot: await capabilityRoot(), bindingManifest: manifest(), workspaceAdapter: adapter, modelAdapter: adapter });
    expect(bindings.map((binding) => binding.bindingId)).toEqual(["poiesis-openai.v1", "poiesis-workspace.list.v1", "poiesis-workspace.read.v1", "poiesis-workspace.search.v1", "poiesis-workspace.check.v1", "poiesis-workspace.replace.v1"]);
    expect(bindings.every((binding) => binding.applicationIds[0].toString("hex") === "a".repeat(64))).toBe(true);
    const check = bindings[4];
    expect(check.decodePayload(encodeEffectPayload("check", { suite: "full" }))).toEqual({ operation: "check", suite: "full" });
    expect(decodeEffectResult("check", check.encodeOutcome({ payload: { exit_code: 0, passed: true, output: "pass", truncated: false } }))).toEqual({ exit_code: 0, passed: true, output: "pass", truncated: false });
    const turn = { contract_digest: "b".repeat(64), goal: { task: "Release", repository: "tkersey/agent", base_revision: "0".repeat(40), current_version: "0.9.0", target_version: "1.0.0", assertions: [] }, counters: { turns: 0, decisions: 0, effect_actions: 0, child_actions: 0 }, phase: "decide", context: { current_version: "0.9.0", target_version: "1.0.0", assertions: [], listing: null, documents: [], assertion_evidence: [], latest_check: null, latest_replace: null, mutations: [], baseline_check_observed: false, latest_check_passed: false, mutation_count: 0, last_check_mutation_count: 0, check_count: 0 }, strategy_local: null };
    expect(bindings[0].decodePayload(encodeDecisionTurn(turn))).toEqual(turn);
    expect(decodeAction(bindings[0].encodeOutcome({ payload: { action: "list_repository", arguments: {} } }))).toEqual({ action: "list_repository", arguments: {} });
  });

  test("binds handler configuration to run and receiver context", async () => {
    const bindings = await createPoiesisBindings({ worldCapabilitiesRoot: await capabilityRoot(), bindingManifest: manifest(), workspaceAdapter: adapter, modelAdapter: adapter });
    expect(bindings[0].configurationIdentity(context)).toMatch(/^[0-9a-f]{64}$/);
    expect(bindings[0].configurationIdentity(context)).not.toBe(bindings[0].configurationIdentity({ ...context, runId: "run-2" }));
    expect(bindings[4].configurationIdentity(context)).not.toBe(bindings[4].configurationIdentity({ ...context, policyDigest: "d".repeat(64) }));
  });

  test("rejects manifest drift before constructing a router", async () => {
    const root = await capabilityRoot();
    const duplicate = manifest(); duplicate.interfaces[1] = { ...duplicate.interfaces[0] };
    await expect(createPoiesisBindings({ worldCapabilitiesRoot: root, bindingManifest: duplicate, workspaceAdapter: adapter, modelAdapter: adapter })).rejects.toThrow(/identity mismatch/);
    const mismatched = manifest(); mismatched.interfaces[0].interfaceId = "0".repeat(64);
    await expect(createPoiesisBindings({ worldCapabilitiesRoot: root, bindingManifest: mismatched, workspaceAdapter: adapter, modelAdapter: adapter })).rejects.toThrow(/derivation mismatch/);
  });

  test("constructs only the released router boundary", async () => {
    const router = await createPoiesisRouter({ worldCapabilitiesRoot: await capabilityRoot(), bindingManifest: manifest(), workspaceAdapter: adapter, modelAdapter: adapter });
    expect(router.bindings).toHaveLength(6);
  });
});
