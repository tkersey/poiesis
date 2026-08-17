# Agent v2.6 custom epistemics surface

This is a generic, policy-free API guide for ordinary Agent Flow source. It is not a Release Steward implementation.

Construct a strategy with `agent.epistemics.custom` using exactly `semantic_identity`, `config`, and `implementation`:

    return agent.epistemics.custom(.{
        .semantic_identity = "non-empty strategy identity",
        .config = .{},
        .implementation = Implementation,
    });

The implementation type needs a non-empty `semantic_identity`, positive `lowering_complexity`, and these declarations. The first two parameters after `Definition` are always the compile-time config and Flow builder:

    validate(comptime Definition: type, comptime config: anytype) void
    Memory(comptime Definition: type, comptime config: anytype) type
    DecisionView(comptime Definition: type, comptime config: anytype) type
    StateSchemaTypes(comptime Definition: type, comptime config: anytype) tuple-of-types
    initialMemory(comptime Definition: type, comptime config: anytype) Memory
    emitInitial(comptime Definition: type, comptime config: anytype, flow: anytype, goal: anytype, comptime context: anytype) agent.Value(Memory)
    emitObserve(comptime Definition: type, comptime config: anytype, flow: anytype, memory: anytype, observation: anytype, comptime context: anytype) agent.Value(Memory)
    emitProject(comptime Definition: type, comptime config: anytype, flow: anytype, memory: anytype) agent.Value(DecisionView)
    emitActionAllowed(comptime Definition: type, comptime config: anytype, flow: anytype, memory: anytype, action: anytype, comptime context: anytype) agent.Value(bool)
    emitFinalAllowed(comptime Definition: type, comptime config: anytype, flow: anytype, memory: anytype, result: anytype, comptime context: anytype) agent.Value(bool)

Specialized observation folding may additionally implement `emitObserveKnown` or `emitObservePayload`; specialized action admission may implement `emitActionAllowedKnown` and `actionAlwaysAllowedKnown`. Specialized action admission still requires the global `emitActionAllowed` fallback.

Useful effect-free Flow primitives are `copy`, `constant`, `productExtract`, `productConstruct`, `productReplace`, `sumTagIs`, `sumExtract`, `optionalSome`, `optionalNone`, `textCompare`, `compareEqZero`, `integerEqual`, `integerLessThan`, `integerAddChecked`, `booleanAnd`, `booleanOr`, `booleanNot`, `select`, `block`, `branch`, `jump`, and `enter`. Use `flow.failValue` only for a typed failure path. Use `flow.block(.segment, .{ ...types... })` to join branch values and `flow.block(.loop_header, .{ ...types... })` for bounded iteration.

The standard constant context provides `zero_index`, `one_index`, `initial_memory_index`, `true_index`, `false_index`, `zero_u8_index`, `one_u8_index`, and `two_u8_index`. Supply `constantValues` and `constantContext` only when more portable constants are required.

All emitted lowerings must be effect-free and non-terminal. Every Memory, DecisionView, StateSchemaTypes entry, config value, and constant must remain Boundary-portable.
