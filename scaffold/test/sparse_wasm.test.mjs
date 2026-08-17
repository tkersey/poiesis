import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const roots = [];
afterEach(async () => { while (roots.length) await rm(roots.pop(), { recursive: true, force: true }); });

test("Poiesis-local sparse WASM compaction preserves the executable surface", async () => {
  const root = await mkdtemp(join(tmpdir(), "poiesis-sparse-wasm-")); roots.push(root);
  const input = resolve("zig-out/release-steward/release-steward.world.wasm");
  const output = join(root, "repacked.wasm");
  const result = Bun.spawnSync([process.execPath, "tools/sparse-wasm-data.mjs", input, output], { stdout: "pipe", stderr: "pipe" });
  expect(result.exitCode).toBe(0);
  const [before, after] = await Promise.all([readFile(input), readFile(output)]);
  expect(after.length).toBeLessThanOrEqual(before.length);
  const module = new WebAssembly.Module(after);
  expect(WebAssembly.Module.imports(module)).toHaveLength(0);
  expect(WebAssembly.Module.exports(module).some((entry) => entry.kind === "memory")).toBe(true);
});
