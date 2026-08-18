import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.ok(result.adapter_maximum_mutation_operations < result.machine_maximum_mutation_operations);
assert.equal(result.model_effect_count, 0);
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
