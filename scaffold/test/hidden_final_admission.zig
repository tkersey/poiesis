const std = @import("std");
const generated_definition = @import("generated_definition");
const generated_semantics = @import("generated_semantics");

test "stub exposes the exact result and failure types" {
    try std.testing.expect(generated_definition.Definition.Result != void);
    try std.testing.expect(generated_definition.Definition.Failure != void);
}

test "generated final-admission counterexamples activate after birth" {
    if (!generated_semantics.generated) return error.SkipZigTest;
    try std.testing.expect(generated_definition.Epistemics.semantic_identity.len > 0);
}
