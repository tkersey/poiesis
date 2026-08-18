import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const result = JSON.parse(await readFile(new URL("../result.json", import.meta.url), "utf8"));
assert.equal(result.compiler_wounds.length, 2);
assert.match(result.smallest_correction, /schema tuple/);
process.stdout.write(`${JSON.stringify({ format: "poiesis-obstruction-reproducer/v1", obstruction: true })}\n`);
