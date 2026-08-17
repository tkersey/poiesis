import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as workspace from "../runtime/workspace-adapter.mjs";
import * as openai from "../runtime/openai-adapter.mjs";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });
const baseRevision = "0".repeat(40);
const applicationId = "a".repeat(64);
const digest = (value) => createHash("sha256").update(value).digest("hex");

function policy(overrides = {}) {
  return {
    format: "poiesis-workspace-policy/v1", repository: "tkersey/fixture", baseRevision,
    readablePaths: ["build.zig", "src/main.zig"], writablePaths: ["src/main.zig"],
    check: { kind: "zig-build-check-v1", argv: ["build", "check", "--summary", "all"] },
    limits: { maximumFileBytes: 16384, maximumListedFiles: 64, maximumChangedFiles: 4, maximumMutationOperations: 6 },
    ...overrides,
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "poiesis-adapter-")); roots.push(root);
  await mkdir(join(root, "src")); await writeFile(join(root, "build.zig"), "// build\n"); await writeFile(join(root, "src/main.zig"), "const version = \"0.9.0\";\n");
  const admitted = workspace.admitWorkspacePolicy(policy(), { repository: "tkersey/fixture", baseRevision });
  const privateRoot = join(root, ".private"); await mkdir(privateRoot);
  return { root, context: { applicationId, runId: "run-1", repository: "tkersey/fixture", baseRevision, workspaceRoot: root, workspaceRootReal: await realpath(root), policy: admitted.policy, policyDigest: admitted.digest, zigExecutable: "/absolute/zig", temporaryHome: privateRoot, approvalRoot: join(privateRoot, "approvals") } };
}

const request = (operation, payload = {}) => ({ requestId: "1".repeat(64), applicationId, payload: { operation, ...payload } });

describe("workspace authority", () => {
  test("admits only sorted exact policies", () => {
    expect(workspace.admitWorkspacePolicy(policy(), { repository: "tkersey/fixture", baseRevision }).digest).toMatch(/^[0-9a-f]{64}$/);
    expect(() => workspace.admitWorkspacePolicy(policy({ readablePaths: ["src/main.zig", "build.zig"] }), { repository: "tkersey/fixture", baseRevision })).toThrow(/byte-sorted/);
    expect(() => workspace.admitWorkspacePolicy(policy({ writablePaths: ["other.zig"] }), { repository: "tkersey/fixture", baseRevision })).toThrow(/subset/);
    expect(() => workspace.admitWorkspacePolicy(policy({ check: { kind: "zig-build-check-v1", argv: ["test"] } }), { repository: "tkersey/fixture", baseRevision })).toThrow(/check mismatch/);
  });

  test("lists, reads, searches with echoed assertion identity, and rejects symlinks", async () => {
    const { root, context } = await fixture();
    expect((await workspace.resolve(context, request("list"))).payload.entries.map((item) => item.path)).toEqual(["build.zig", "src/main.zig"]);
    expect((await workspace.resolve(context, request("read", { path: "src/main.zig" }))).payload.sha256).toBe(digest("const version = \"0.9.0\";\n"));
    const searched = await workspace.resolve(context, request("search", { assertion_index: 3, query: "0.9.0", path_prefix: "src" }));
    expect(searched.payload).toMatchObject({ assertion_index: 3, query: "0.9.0", path_prefix: "src", truncated: false });
    await rm(join(root, "src/main.zig")); await symlink(join(root, "build.zig"), join(root, "src/main.zig"));
    expect((await workspace.resolve(context, request("list"))).status).toBe("failed");
  });

  test("binds atomic replacement approval and makes retry idempotent", async () => {
    const { root, context } = await fixture(); const before = "const version = \"0.9.0\";\n"; const replacement = "const version = \"1.0.0\";\n";
    const effect = request("replace", { path: "src/main.zig", expected_sha256: digest(before), replacement, rationale: "Release 1.0.0" });
    const first = await workspace.resolve(context, effect); expect(first.payload.value.already_applied).toBe(false);
    const second = await workspace.resolve(context, effect); expect(second.payload.value.already_applied).toBe(true);
    expect(await readFile(join(root, "src/main.zig"), "utf8")).toBe(replacement);
    const approval = JSON.parse(await readFile(join(context.approvalRoot, `${effect.requestId}.json`), "utf8"));
    expect(approval).toMatchObject({ applicationId, runId: "run-1", policyDigest: context.policyDigest, approved: true });
  });
});

const decisionContractDigest = "b".repeat(64);
const decisionContract = {
  format: "agent-decision-contract/v2",
  semanticDigest: decisionContractDigest,
  instructions: "Return one action.",
  actionSchema: { oneOf: [{ type: "object", properties: { action: { const: "list_repository" }, arguments: { type: "object", properties: {} } } }] },
};
const modelRequest = { requestId: "2".repeat(64), payload: { contract_digest: decisionContractDigest } };
const providerResponse = (content) => ({ id: "resp_1", status: "completed", model: "gpt-test", output: [{ type: "message", role: "assistant", content }], usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 } });

describe("OpenAI decision authority", () => {
  test("uses strict schema, no tools, no storage, and returns one canonical action", async () => {
    let sent;
    const context = { applicationId, decisionContract, decisionContractDigest, model: "gpt-test", allowedModels: ["gpt-test"], secrets: { OPENAI_API_KEY: "test-only" }, fetchImplementation: async (_url, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify(providerResponse([{ type: "output_text", text: JSON.stringify({ value: { action: "list_repository", arguments: {} } }) }])), { status: 200 }); } };
    const result = await openai.resolve(context, modelRequest);
    expect(result).toMatchObject({ status: "ok", payload: { action: "list_repository", arguments: {} } });
    expect(sent).toMatchObject({ model: "gpt-test", store: false, background: false, tools: [] });
    expect(sent.text.format).toMatchObject({ type: "json_schema", strict: true, name: "poiesis_release_steward_action" });
  });

  test("rejects missing authority, refusals, and multiple messages", async () => {
    expect((await openai.preflight({ decisionContract, decisionContractDigest, allowedModels: [] }, modelRequest)).status).toBe("rejected");
    for (const response of [
      providerResponse([{ type: "refusal", refusal: "no" }]),
      { ...providerResponse([{ type: "output_text", text: "{}" }]), output: [providerResponse([]).output[0], providerResponse([]).output[0]] },
    ]) {
      const context = { applicationId, decisionContract, decisionContractDigest, model: "gpt-test", allowedModels: ["gpt-test"], secrets: { OPENAI_API_KEY: "test-only" }, fetchImplementation: async () => new Response(JSON.stringify(response), { status: 200 }) };
      expect((await openai.resolve(context, modelRequest)).status).toBe("failed");
    }
  });
});
