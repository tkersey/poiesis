import { describe, expect, test } from "bun:test";
import { assertBirthChangedPaths, buildVerificationRecord, runFixture } from "../../tools/verify-birth.mjs";
import { _birthInternals } from "../../tools/run-birth.mjs";

const paths = [..._birthInternals.expectedChangedPaths];
const digest = "a".repeat(64);

describe("independent birth verifier", () => {
  test("admits only an exact four-file deterministic record", () => {
    const record = buildVerificationRecord({ parentCandidateCommit: "1".repeat(40), parentApplicationId: digest, scaffoldCommit: "2".repeat(40), worktreeHead: "2".repeat(40), changedPaths: paths, fileDigests: Object.fromEntries(paths.map((path) => [path, digest])), diffSha256: digest, bunTestFiles: ["scaffold/test/all.test.mjs"] });
    expect(record).toMatchObject({ format: "poiesis-birth-verification/v1", changed_paths: paths, independent_verification: true, manual_file_edits: 0 });
  });

  test("rejects unauthorized and incomplete path sets", () => {
    expect(() => assertBirthChangedPaths([...paths, "README.md"])).toThrow();
    expect(() => assertBirthChangedPaths(paths.slice(1))).toThrow();
    expect(runFixture("unauthorized-write")).toEqual({ fixture: "unauthorized-write", rejected: true });
  });
});
