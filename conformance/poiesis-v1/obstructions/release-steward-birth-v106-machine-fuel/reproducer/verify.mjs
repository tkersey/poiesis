import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
const parent = JSON.parse(await readFile(new URL("../../../parent.lock.json", import.meta.url), "utf8"));

assert.equal(result.format, "poiesis-obstruction/v1");
assert.equal(result.owner, "parent_application_obstruction");
assert.equal(result.failed_parent_release, "v1.0.6");
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
assert.equal(result.maximum_decisions, 48);
assert.equal(result.maximum_effect_actions, 47);
assert.equal(result.maximum_mutation_operations, 10);
assert.equal(result.maximum_changed_files, 4);
assert.equal(result.machine_abi, parent.tuple.machineAbi);
assert.equal(result.machine_state, parent.tuple.machineStateFormat);
assert.equal(result.application_abi, parent.tuple.applicationAbi);
assert.equal(result.frame, parent.tuple.frame);
assert.equal(result.effect_protocol, parent.tuple.effectProtocol);

process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
