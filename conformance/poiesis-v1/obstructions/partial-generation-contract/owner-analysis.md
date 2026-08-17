# Owner analysis

Classification: `capability_obstruction`

Owner: Poiesis immutable scaffold.

The first defect was a receiver-authored partial-state invariant: full validation after an early required replacement could not pass while the scaffold simultaneously required the replaced identity to remain the stub value. The second defect was a missing receiver-readable compiler surface; repository search correctly returned no definition for the required Agent custom epistemics API.

The smallest correction relaxes only the partial stub identity checks and adds a generic API guide derived from released Agent v2.6.0. It adds no Release Steward policy, observation law, action plan, final law, test solution, or generated source.

The parent application, Agent release, Boundary, World, Machine ABI/state, Application ABI, Frame, host behavior, and Effect protocol do not change.
