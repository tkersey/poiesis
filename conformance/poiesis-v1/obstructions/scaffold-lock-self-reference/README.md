# Scaffold lock self-reference obstruction

The literal scaffold-freeze ordering cannot be constructed as written.

The tagged scaffold commit is required to contain `scaffold.lock.json`, while that lock must contain the exact SHA of the same tagged commit. The lock must also contain the birth-policy digest, while the birth policy itself must contain that same commit as `baseRevision` and is authored only after scaffold freeze.

This creates the dependency cycle:

```text
commit SHA
  -> scaffold.lock baselineCommit
  -> scaffold.lock blob SHA
  -> tree SHA
  -> commit SHA

commit SHA
  -> birth policy baseRevision
  -> birth policy SHA-256
  -> scaffold.lock birthPolicySha256
  -> scaffold.lock blob SHA
  -> tree SHA
  -> commit SHA
```

Git can hash already-complete commit content; it cannot construct this commit without solving a cryptographic fixed point. The reproducer makes the cycle executable and confirms ordinary iterative construction does not stabilize.

## Smallest preserving realization

Poiesis uses the same two-layer self-freeze already required by a release candidate:

1. Commit **A** contains the complete immutable scaffold and four stubs, but no birth brief, birth policy, or scaffold lock.
2. Tag `poiesis-v1-scaffold` points immutably to **A**.
3. Evidence commit **B**, whose first parent is **A**, adds `scaffold.lock.json`, `birth-brief.md`, and `birth-workspace-policy.json`.
4. The lock and policy both name **A**, and the lock contains the exact policy digest.
5. The birth branch and frozen-parent target both start at **A**. The receiver supplies brief, policy, and lock evidence from **B**; none becomes model-authored repository state.

This changes only the impossible lock-publication ordering. Parent bytes, child source ownership, four-file authority, scaffold tree, task chronology, ABIs, Frame, and Effect protocol remain unchanged.

Run the minimized reproducer:

```sh
bun conformance/poiesis-v1/obstructions/scaffold-lock-self-reference/reproducer/verify.mjs
```
