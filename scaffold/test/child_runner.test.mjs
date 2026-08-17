import { describe, expect, test } from "bun:test";
import { analyzeInterfaceSequence, measurementGates, runChild, _childRunnerInternals } from "../../tools/run-child.mjs";

describe("Release Steward child runner", () => {
  test("keeps baseline lifecycle lanes honest while semantics remain stubs", async () => {
    for (const mode of ["deterministic", "retry", "replay", "measure"]) {
      const result = await runChild({ mode });
      expect(result).toMatchObject({ stub: true, receipt: { mode, stage: "stub", generated: false, proof_applicable: false } });
    }
  });

  test("checks mutation, check, and assertion freshness from the effect trace", () => {
    const events = [
      { interfaceLabel: "repo.check.v1" },
      { interfaceLabel: "repo.replace.approved.v2", applied: true },
      { interfaceLabel: "repo.check.v1" },
      { interfaceLabel: "repo.release-search.v1", assertionIndex: 0 },
      { interfaceLabel: "repo.release-search.v1", assertionIndex: 1 },
    ];
    expect(analyzeInterfaceSequence(events, 1, 2)).toEqual({ baselineCheck: true, mutations: 1, lastCheckMutation: 1, assertions: 2 });
    expect(() => analyzeInterfaceSequence(events.slice(1), 1, 2)).toThrow();
  });

  test("enforces every declared measurement ceiling", () => {
    const passing = measurementGates({ applicationWasmBytes: 1, applicationStateLimitBytes: 1, peakFrameBytes: 1, peakMachineStateBytes: 1, wasmStackBytes: 1, wasmMemoryBytes: 1, externalEffectCount: 1, modelEffectCount: 1, mutationCount: 1, changedFileCount: 2 });
    expect(Object.values(passing).every(Boolean)).toBe(true);
    expect(measurementGates({ applicationWasmBytes: 7 * 1024 * 1024, applicationStateLimitBytes: 1, peakFrameBytes: 1, peakMachineStateBytes: 1, wasmStackBytes: 1, wasmMemoryBytes: 1, externalEffectCount: 1, modelEffectCount: 1, mutationCount: 1, changedFileCount: 2 }).applicationWasm).toBe(false);
  });

  test("parses only the closed mode surface", () => {
    expect(_childRunnerInternals.parseArgs(["--mode", "deterministic"])).toEqual({ mode: "deterministic" });
    expect(() => _childRunnerInternals.parseArgs(["--mode", "unknown"])).toThrow();
  });
});
