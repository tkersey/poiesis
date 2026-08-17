const agent = @import("agent");
const contract = @import("release_contract");
const generated_epistemics = @import("generated_epistemics");
const generated_policy = @import("generated_policy");

pub const semantic_identity = "poiesis_stub_v1";

pub const Definition = agent.define(.{
    .name = "release-steward",
    .version = "1.0.0",
    .instructions = generated_policy.instructions,
    .Goal = contract.Goal,
    .Action = contract.Action,
    .Observation = contract.Observation,
    .Result = contract.ReleaseResult,
    .Failure = contract.Failure,
    .decision = .{
        .interface = "model.decide.v1",
        .maximum_request_bytes = 256 * 1024,
        .maximum_result_bytes = 64 * 1024,
    },
    .actions = .{
        agent.action.effect(.list_repository, .list_repository, contract.ListRepository, .{
            .name = "list_repository",
            .description = "List receiver-admitted existing repository files.",
            .class = .tool,
        }),
        agent.action.effect(.read_file, .read_file, contract.ReadFile, .{
            .name = "read_file",
            .description = "Read one admitted complete UTF-8 file and digest.",
            .class = .tool,
        }),
        agent.action.effect(.search_assertion, .search_assertion, contract.SearchAssertion, .{
            .name = "search_assertion",
            .description = "Evaluate one exact receiver-authored release assertion.",
            .class = .tool,
        }),
        agent.action.effect(.run_check, .run_check, contract.RunCheck, .{
            .name = "run_check",
            .description = "Run the fixed complete Zig validation command.",
            .class = .tool,
        }),
        agent.action.effect(.replace_file, .replace_file, contract.ReplaceFile, .{
            .name = "replace_file",
            .description = "Propose one digest-bound complete replacement for approval.",
            .class = .human,
        }),
        agent.action.final(.final, .{
            .name = "final",
            .description = "Return one typed Release Steward result.",
            .class = .custom,
        }),
        agent.action.fail(.abort, .{
            .name = "abort",
            .description = "Terminate with one bounded authored failure.",
            .class = .custom,
        }),
    },
    .budget = generated_policy.budget,
});

pub const Strategy = agent.strategy.react(.{});
pub const Epistemics = generated_epistemics.Epistemics(agent, contract);
pub const Compiled = agent.compile(Definition, Strategy, Epistemics, .{
    .machine = generated_policy.machine_limits,
});
