import { describe, expect, test } from "bun:test";
import { assertTargetRemote, buildChildPublicationRecord, childPullRequestBody, taskSlug } from "../../tools/publish-child.mjs";

const digest = "a".repeat(64); const commit = "b".repeat(40); const pullRequest = { number: 9, url: "https://github.com/tkersey/agent/pull/9", isDraft: true, headRefOid: commit, baseRefName: "main", state: "OPEN" };

describe("child publication", () => {
  test("derives a bounded stable branch and proof-bearing body", () => {
    expect(taskSlug("1.0.0", digest)).toBe("1-0-0-aaaaaaaaaaaa");
    const body = childPullRequestBody({ parentCandidateCommit: commit, childCandidateSha256: digest, applicationId: digest, liveReceiptSha256: digest, diffSha256: digest, verificationDigest: digest });
    expect(body).toContain("ordinary human review"); expect(body).toContain(digest);
  });

  test("binds only the exact target remote and draft PR head", () => {
    expect(assertTargetRemote("https://github.com/tkersey/agent.git", "tkersey/agent")).toContain("tkersey/agent");
    expect(() => assertTargetRemote("https://github.com/example/agent.git", "tkersey/agent")).toThrow();
    const record = buildChildPublicationRecord({ repository: "tkersey/agent", branch: "poiesis/v1-release-steward-1-0-0-aaaaaaaaaaaa", baseRevision: "c".repeat(40), parentCandidateCommit: "d".repeat(40), childCandidateSha256: digest, applicationId: digest, liveReceiptSha256: digest, diffSha256: digest, verificationDigest: digest, publishedHead: commit, publishedTree: "e".repeat(40), pullRequest });
    expect(record).toMatchObject({ format: "poiesis-child-publication/v1", draft: true, published_tree_matches_verified_diff: true });
  });
});
