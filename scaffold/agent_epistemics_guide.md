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

Use the immutable contract-owned schema tuple; it includes every structured contract value that generated Flow may touch:

    pub fn StateSchemaTypes(comptime _: type, comptime _: anytype)
        @TypeOf(contract.epistemicStateSchemaTypes())
    {
        return contract.epistemicStateSchemaTypes();
    }

Keep custom `config` exactly `.config = .{}`. Do not place `agent`, `contract`, types, functions, or other comptime-only values in config: config is a portable runtime product. Close over the `agent` and `contract` comptime parameters in the implementation type returned by `Epistemics` instead.

Specialized observation folding may additionally implement `emitObserveKnown` or `emitObservePayload`; specialized action admission may implement `emitActionAllowedKnown` and `actionAlwaysAllowedKnown`. Specialized action admission still requires the global `emitActionAllowed` fallback.

Useful effect-free Flow primitives are `copy`, `constant`, `productExtract`, `productConstruct`, `productReplace`, `sumTagIs`, `sumExtract`, `optionalSome`, `optionalNone`, `textCompare`, `compareEqZero`, `integerEqual`, `integerGreaterEqual`, `integerAdd`, `booleanAnd`, `booleanOr`, `booleanNot`, `select`, `block`, `branch`, `jump`, and `enter`. Product and sum indices are compile-time `u16` values and come first: `productExtract(index, product)`, `productReplace(index, product, replacement)`, `sumTagIs(index, sum)`, and `sumExtract(index, sum)`. Use `flow.failValue` only for a typed failure path. Use `flow.block(.segment, .{ ...types... })` to join branch values and `flow.block(.loop_header, .{ ...types... })` for bounded iteration.

Exact call shapes used by generated lowerings:

    constant(T, constant_index)
    productConstruct(T, .{ field_values... })
    optionalSome(?T, value)
    optionalNone(?T)
    vectorEmpty(VectorType)
    vectorLength(vector)
    vectorGet(vector, u32_index)
    vectorSet(vector, u32_index, element)
    vectorPush(vector, element)
    vectorTruncate(vector, u32_length)

A block's type tuple is its parameter list. Every jump or branch edge must pass exactly one argument of the matching type for every declared parameter:

    const yes = flow.block(.segment, .{ contract.Memory, contract.Observation });
    const no = flow.block(.segment, .{ contract.Memory, contract.Observation });
    flow.branch(condition, yes, .{ memory, observation }, no, .{ memory, observation });
    const values = flow.enter(yes); // values[0] is Memory; values[1] is Observation
    flow.jump(joined, .{ next_memory });

Terminate the current block with `jump`, `branch`, `failValue`, or another terminal operation before calling `enter` on a successor. Do not declare parameters that the incoming edges do not carry.

The standard constant context provides `zero_index`, `one_index`, `initial_memory_index`, `true_index`, `false_index`, `zero_u8_index`, `one_u8_index`, and `two_u8_index`. Supply `constantValues` and `constantContext` only when more portable constants are required.

All emitted lowerings must be effect-free and non-terminal. Every Memory, DecisionView, StateSchemaTypes entry, config value, and constant must remain Boundary-portable.
