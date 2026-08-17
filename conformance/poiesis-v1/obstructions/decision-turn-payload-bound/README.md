# DecisionTurn payload-bound obstruction

The exact required Release Steward DecisionView has a 257,898-byte maximum canonical encoding. Agent's ReAct DecisionTurn adds the contract digest, Goal, counters, and phase for an exact 270,678-byte maximum. The original 256 KiB decision and World effect-payload bounds therefore cannot compile.

The r2 live attempt reached a parent-authored custom epistemics replacement, then Agent correctly rejected the child with `agent DecisionTurn exceeds decision.maximum_request_bytes`. The 16 KiB check result saturated, and frozen Praxis could not fold it within the parent step-fuel ceiling.

The minimized successor raises only the child decision request and application effect-payload ceilings to 272 KiB. It changes no authority, semantic type, file bound, runtime-memory bound, ABI, protocol, or released parent byte.
