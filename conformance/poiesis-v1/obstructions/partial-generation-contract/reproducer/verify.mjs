import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
function source(path) {
  const result = Bun.spawnSync(["git", "show", `poiesis-v1-scaffold-r1:${path}`], { cwd: root, stdout: "pipe", stderr: "pipe" });
  assert.equal(result.exitCode, 0);
  return Buffer.from(result.stdout).toString("utf8");
}

const visible = source("test/generated_semantics.zig");
const hidden = source("scaffold/test/hidden_child_contract.zig");
assert.ok(visible.includes('expectEqualStrings("poiesis_stub_v1", generated_policy.semantic_identity)'));
assert.ok(hidden.includes('expectEqualStrings("poiesis_stub_v1", generated_policy.semantic_identity)'));
assert.ok(!source("scaffold/working_set_helpers.zig").includes("agent.epistemics.custom"));
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
