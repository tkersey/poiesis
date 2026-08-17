import { describe, expect, test } from "bun:test";
import { canonicalPolicyDigest, _freezeScaffoldInternals } from "../../tools/freeze-scaffold.mjs";

describe("two-layer scaffold freeze", () => {
  test("canonicalizes policy identity independently of JSON key order", () => {
    expect(canonicalPolicyDigest({ b: 2, a: 1 })).toBe(canonicalPolicyDigest({ a: 1, b: 2 }));
    expect(_freezeScaffoldInternals.writablePaths).toEqual(["src/generated_definition.zig", "src/generated_epistemics.zig", "src/generated_policy.zig", "test/generated_semantics.zig"]);
  });

  test("admits only tag and evidence phases", () => {
    expect(_freezeScaffoldInternals.parseArgs(["--repository-root", "/repo", "--phase", "tag"])).toEqual({ repositoryRoot: "/repo", phase: "tag", tag: "poiesis-v1-scaffold" });
    expect(_freezeScaffoldInternals.parseArgs(["--repository-root", "/repo", "--phase", "tag", "--tag", "poiesis-v1-scaffold-r1"])).toEqual({ repositoryRoot: "/repo", phase: "tag", tag: "poiesis-v1-scaffold-r1" });
    expect(() => _freezeScaffoldInternals.parseArgs(["--repository-root", "/repo", "--phase", "tag", "--tag", "poiesis-v1-scaffold-next"])).toThrow();
    expect(() => _freezeScaffoldInternals.parseArgs(["--repository-root", "/repo", "--phase", "unknown"])).toThrow();
  });
});
