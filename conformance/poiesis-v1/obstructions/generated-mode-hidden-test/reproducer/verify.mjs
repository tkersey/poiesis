import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const result = Bun.spawnSync(["git", "show", "poiesis-v1-scaffold:scaffold/test/hidden_child_contract.zig"], {
  cwd: fileURLToPath(new URL("../../../../../", import.meta.url)),
  stdout: "pipe",
  stderr: "pipe",
});
assert.equal(result.exitCode, 0);
const source = Buffer.from(result.stdout).toString("utf8");
assert.ok(source.includes('try std.testing.expect(!generated_semantics.generated);'));
assert.ok(source.includes('try std.testing.expectEqualStrings("poiesis_stub_v1", generated_policy.semantic_identity);'));
assert.ok(source.includes('if (!generated_semantics.generated) return error.SkipZigTest;'));
assert.ok(source.includes('try std.testing.expect(!std.mem.eql(u8, "poiesis_stub_v1", generated_policy.semantic_identity));'));
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
