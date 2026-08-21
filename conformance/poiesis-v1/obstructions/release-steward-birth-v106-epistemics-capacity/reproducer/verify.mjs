import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../../../../..", import.meta.url).pathname);
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: null });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return Buffer.from(result.stdout);
};

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.equal(result.format, "poiesis-obstruction/v1");
assert.equal(result.owner, "capability_obstruction");
assert.equal(result.parent_release, "v1.0.6");
assert.equal(result.terminal_failure, "capacity_exceeded");
assert.equal(result.final_model_action, "abort");
assert.equal(result.generated_epistemics_bytes, 16 * 1024);
assert.equal(result.fresh_check_after_every_replacement, true);

const failedHelper = git(["show", "poiesis-v1-scaffold-r11:scaffold/working_set_helpers.zig"]);
assert.equal(failedHelper.length, result.failed_scaffold_helper_bytes);
assert.equal(sha256(failedHelper), result.failed_scaffold_helper_sha256);
assert.equal(failedHelper.toString("utf8").includes("upsertProductKey"), false);

const successor = await readFile(path.join(root, "scaffold/working_set_helpers.zig"), "utf8");
for (const name of ["zero", "one", "boolean", "increment", "replaceProductField", "upsertProductKey", "vectorContainsTextField", "vectorContainsTextPair"]) {
  assert.ok(successor.includes(`pub fn ${name}(`), `missing generic helper ${name}`);
}
for (const forbidden of ["ReleaseResult", "maximum_mutation_operations", "replace_file", "emitFinalAllowed", "assertions_satisfied"]) {
  assert.equal(successor.includes(forbidden), false, `helper contains policy token ${forbidden}`);
}

process.stdout.write("poiesis_v106_epistemics_capacity_obstruction=true\n");
