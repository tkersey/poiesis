pub const semantic_identity = "poiesis_stub_v1";

pub const instructions =
    "This is the compilable Poiesis scaffold stub. Inspect only receiver-admitted " ++
    "data and abort because generated Release Steward semantics are not installed.";

pub const budget = .{
    .maximum_turns = 48,
    .maximum_decisions = 48,
    .maximum_effect_actions = 47,
    .maximum_child_actions = 0,
};

pub const machine_limits = .{
    .maximum_frames = 48,
    .maximum_state_bytes = 511 * 1024,
    .maximum_machine_fuel = 8_000_000,
};
