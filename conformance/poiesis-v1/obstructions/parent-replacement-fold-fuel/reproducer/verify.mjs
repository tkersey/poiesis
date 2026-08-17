import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.equal(result.owner, "parent_application_obstruction");
assert.ok(result.replacement_bytes <= result.declared_maximum_file_bytes);
assert.ok(result.replacement_result_bytes <= result.declared_maximum_file_bytes);
assert.equal(result.identical_yield_count, 10);
assert.equal(result.manual_file_edits, 0);
assert.equal(result.unapproved_writes, 0);
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
