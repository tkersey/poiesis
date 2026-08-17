# Owner analysis

Classification: `capability_obstruction`

Owner: Poiesis immutable scaffold.

The parent, Agent compiler, Boundary calculus, World closure, host, and repository capabilities all behaved according to their released contracts. The contradiction is local to the receiver-authored hidden test: one immutable test simultaneously forbids the required `generated` flag and non-placeholder identity.

No child-source change can satisfy both predicates, and humans may not edit generated source. The smallest correction is to make the baseline-only hidden assertion conditional on `generated == false`; the generated-mode assertion remains active and independently requires a non-stub identity.

The parent application, child stack, Machine ABI/state, Application ABI, Frame, host behavior, and Effect protocol do not change.
