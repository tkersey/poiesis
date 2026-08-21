# Release Steward birth v1.0.6 epistemics capacity

The first clean birth using authenticated Praxis v1.0.6 and scaffold r11
crossed the v1.0.5 freshness failure: it performed five approved replacements,
ran a fresh full check after each mutation, and reread the affected path without
an unchanged-read loop.

The run still did not complete. Four revisions of
`src/generated_epistemics.zig` filled the file to exactly 16 KiB, leaving a
truncated expression at line 349. The final admitted model action was the typed
`abort(capacity_exceeded)`. Only policy and epistemics changed; definition and
visible semantic tests remained stubs.

The generated file spent material capacity implementing policy-neutral Flow
mechanics—portable constants, product replacement, keyed vector upsert, and
bounded vector scans—because the immutable helper exposed only text equality.
The Poiesis specification assigns generic lowering helpers needed to meet the
16 KiB bound to the scaffold. Scaffold r12 therefore expands only that generic
helper boundary; it does not add Release Steward field indices, capacity
predicates, action policy, final policy, or a reference implementation.
