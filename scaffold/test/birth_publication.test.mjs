import { describe, expect, test } from "bun:test";
import { assertPoiesisRemote, birthPullRequestBody, buildPublicationRecord, _birthPublicationInternals } from "../../tools/publish-birth.mjs";

const digest = "a".repeat(64);
const commit = "b".repeat(40);
const pullRequest = { number: 7, url: "https://github.com/tkersey/poiesis/pull/7", isDraft: true, headRefOid: commit, baseRefName: "main", state: "OPEN" };

describe("birth publication", () => {
  test("binds one draft PR to verified parent and diff identities", () => {
    const record = buildPublicationRecord({ parentCandidateCommit: "c".repeat(40), parentApplicationId: digest, scaffoldCommit: "d".repeat(40), diffSha256: digest, birthReceiptSha256: digest, verificationDigest: digest, publishedHead: commit, publishedTree: "e".repeat(40), pullRequest });
    expect(record).toMatchObject({ format: "poiesis-birth-publication/v1", repository: "tkersey/poiesis", branch: _birthPublicationInternals.branch, draft: true, published_tree_matches_verified_diff: true });
    const body = birthPullRequestBody({ parentCandidateCommit: record.parent_candidate_commit, parentApplicationId: record.parent_application_id, scaffoldCommit: record.base_revision, diffSha256: record.verified_diff_sha256, birthReceiptSha256: record.birth_receipt_sha256, verificationDigest: record.independent_verification_sha256 });
    expect(body).toContain(record.verified_diff_sha256);
    expect(body).toContain("ordinary human review");
  });

  test("rejects remote or PR identity drift", () => {
    expect(assertPoiesisRemote("https://github.com/tkersey/poiesis.git")).toContain("tkersey/poiesis");
    expect(() => assertPoiesisRemote("https://github.com/example/poiesis.git")).toThrow();
    expect(() => buildPublicationRecord({ parentCandidateCommit: "c".repeat(40), parentApplicationId: digest, scaffoldCommit: "d".repeat(40), diffSha256: digest, birthReceiptSha256: digest, verificationDigest: digest, publishedHead: commit, publishedTree: "e".repeat(40), pullRequest: { ...pullRequest, isDraft: false } })).toThrow();
  });
});
