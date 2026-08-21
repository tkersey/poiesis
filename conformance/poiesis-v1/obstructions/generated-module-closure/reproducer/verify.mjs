import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("../../../../..", import.meta.url).pathname);
const git = (args) => {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.error || result.status !== 0) throw new Error(`git ${args.join(" ")} failed`);
  return result.stdout;
};

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
const failedBuild = git(["show", `${result.failed_scaffold_tag}:build.zig`]);
const failedGuide = git(["show", `${result.failed_scaffold_tag}:scaffold/agent_epistemics_guide.md`]);
assert.ok(failedGuide.includes("Import it as `working_set_helpers`"));
assert.equal(failedBuild.includes('.{ .name = "working_set_helpers", .module = working_set_helpers_module }'), false);

const currentBuild = await readFile(path.join(root, "build.zig"), "utf8");
const policy = await readFile(path.join(root, "src/generated_policy.zig"), "utf8");
const epistemics = await readFile(path.join(root, "src/generated_epistemics.zig"), "utf8");
assert.ok(currentBuild.includes('.{ .name = "working_set_helpers", .module = working_set_helpers_module }'));
assert.ok(currentBuild.includes('.{ .name = "generated_policy", .module = policy_module }'));
assert.ok(policy.includes('@import("working_set_helpers")'));
assert.ok(epistemics.includes('@import("working_set_helpers")'));
assert.ok(epistemics.includes('@import("generated_policy")'));
assert.equal(result.writable_file_count_changed, false);
assert.equal(result.authority_changed, false);
assert.equal(result.reference_solution_supplied, false);
process.stdout.write("poiesis_generated_module_closure_obstruction=true\n");
