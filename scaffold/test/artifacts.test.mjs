import { describe, expect, test } from "bun:test";
import { assertChronology, runFixture, verifyCurrent } from "../../tools/check-artifacts.mjs";

describe("Poiesis artifact and phase verifier", () => {
  test("binds the current semantic slots and generated artifacts", async () => {
    const result = await verifyCurrent({ expect: "stub" });
    expect(result.semanticState).toBe("stub");
    expect(result.applicationId).toMatch(/^[0-9a-f]{64}$/);
    expect(result.wasmSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.vectorCount).toBe(32);
  });

  test("rejects hidden solution and early task fixtures", () => {
    expect(runFixture("hidden-solution")).toEqual({ fixture: "hidden-solution", rejected: true });
    expect(runFixture("early-task")).toEqual({ fixture: "early-task", rejected: true });
    expect(() => assertChronology({ presentPaths: [], sourceTagPresent: false, candidateTagPresent: false })).not.toThrow();
  });
});
