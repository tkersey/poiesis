import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.equal(result.failed_live_receipt_sha256.length, 2);
assert.deepEqual(result.compiler_wounds, [
  "StateSchemaTypes tuple type/value mismatch",
  "custom config contains comptime fields",
]);
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
