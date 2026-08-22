import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
const parent = JSON.parse(await readFile(new URL("../../../parent.lock.json", import.meta.url), "utf8"));

assert.deepEqual(Object.keys(result).sort(), [
  "application_abi", "applied_replacements", "effect_count", "effect_protocol",
  "failed_live_receipt_sha256", "failed_parent_definition_sha256", "failed_parent_release",
  "failed_parent_tag_commit", "failed_scaffold_commit", "failed_terminal_frame_id",
  "failed_terminal_frame_block_sha256",
  "failed_total_machine_fuel", "failure", "format", "frame", "generated_epistemics_bytes",
  "machine_abi", "machine_state", "maximum_changed_files", "maximum_decisions",
  "maximum_effect_actions", "maximum_mutation_operations", "model_authored_abort", "owner",
  "successor_parent_definition_sha256", "successor_parent_release",
  "successor_parent_tag_commit", "successor_total_machine_fuel",
].sort());
assert.equal(result.format, "poiesis-obstruction/v1");
assert.equal(result.owner, "parent_application_obstruction");
assert.equal(result.failed_parent_release, "v1.0.6");
assert.match(result.failed_parent_tag_commit, /^[0-9a-f]{40}$/);
assert.match(result.failed_parent_definition_sha256, /^[0-9a-f]{64}$/);
assert.match(result.failed_live_receipt_sha256, /^[0-9a-f]{64}$/);
assert.match(result.failed_terminal_frame_id, /^[0-9a-f]{64}$/);
assert.equal(result.failure, "Boundary Machine execution budget exceeded");
assert.equal(result.effect_count, 58);
assert.equal(result.applied_replacements, 6);
assert.equal(result.generated_epistemics_bytes, 14_559);
assert.equal(result.model_authored_abort, false);
assert.equal(result.failed_total_machine_fuel, 16_000_000);
assert.equal(result.successor_total_machine_fuel, 32_000_000);
assert.equal(result.successor_parent_release, parent.release.tag);
assert.equal(result.successor_parent_tag_commit, parent.release.tagCommit);
assert.equal(result.successor_parent_definition_sha256, parent.release.definitionSha256);
assert.equal(result.maximum_decisions, 48);
assert.equal(result.maximum_effect_actions, 47);
assert.equal(result.maximum_mutation_operations, 10);
assert.equal(result.maximum_changed_files, 4);
assert.equal(result.machine_abi, parent.tuple.machineAbi);
assert.equal(result.machine_state, parent.tuple.machineStateFormat);
assert.equal(result.application_abi, parent.tuple.applicationAbi);
assert.equal(result.frame, parent.tuple.frame);
assert.equal(result.effect_protocol, parent.tuple.effectProtocol);

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const verification = spawnSync(process.execPath, ["tools/verify-parent.mjs"], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (verification.error || verification.status !== 0) {
  throw new Error(`authenticated parent verification failed\n${verification.stdout ?? ""}${verification.stderr ?? ""}`);
}
assert.match(verification.stdout, new RegExp(`failed_parent_definition_sha256=${result.failed_parent_definition_sha256}`));
assert.match(verification.stdout, new RegExp(`failed_parent_maximum_machine_fuel=${result.failed_total_machine_fuel}`));
assert.match(verification.stdout, new RegExp(`parent_definition_sha256=${result.successor_parent_definition_sha256}`));
assert.match(verification.stdout, new RegExp(`parent_maximum_machine_fuel=${result.successor_total_machine_fuel}`));

process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
