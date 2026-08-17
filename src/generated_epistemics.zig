pub const semantic_identity = "poiesis_stub_v1";

pub fn Epistemics(comptime agent: type, comptime contract: type) type {
    _ = contract;
    return agent.epistemics.verbatim(.{
        .maximum_observations = 1,
        .overflow = .drop_oldest,
        .final = agent.final_policy.none,
    });
}
