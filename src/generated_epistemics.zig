const generated_policy = @import("generated_policy");
const working_set_helpers = @import("working_set_helpers");

comptime {
    _ = generated_policy.semantic_identity;
    _ = working_set_helpers.textEqual;
}

pub const semantic_identity = "poiesis_stub_v1";

pub fn Epistemics(comptime agent: type, comptime contract: type) type {
    _ = contract;
    return agent.epistemics.verbatim(.{
        .maximum_observations = 1,
        .overflow = .drop_oldest,
        .final = agent.final_policy.none,
    });
}
