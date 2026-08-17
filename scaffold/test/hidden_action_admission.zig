const std = @import("std");
const generated_definition = @import("generated_definition");
const generated_semantics = @import("generated_semantics");

test "stub compiles the complete closed action algebra" {
    try std.testing.expectEqual(@as(usize, 7), generated_definition.Definition.action_count);
}

test "generated action-admission counterexamples activate after birth" {
    if (!generated_semantics.generated) return error.SkipZigTest;
    try std.testing.expectEqualStrings(
        "agent.epistemics.release-steward.v1",
        generated_definition.Epistemics.semantic_identity,
    );
}
