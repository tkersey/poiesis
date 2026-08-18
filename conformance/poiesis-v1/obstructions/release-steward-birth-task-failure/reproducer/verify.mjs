import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.equal(result.owner, "task_failure");
assert.equal(result.failed_live_receipt_sha256.length, 8);
assert.equal(result.maximum_replacements, 10);
assert.equal(result.manual_file_edits, 0);
assert.equal(result.unapproved_writes, 0);
assert.equal(result.reference_solution_supplied, false);
assert.equal(result.different_model_attempted, true);
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
