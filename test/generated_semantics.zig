const std = @import("std");
const generated_definition = @import("generated_definition");
const generated_epistemics = @import("generated_epistemics");
const generated_policy = @import("generated_policy");

pub const generated = false;

test "scaffold semantic files remain explicit compilable stubs" {
    try std.testing.expect(!generated);
    try std.testing.expect(generated_policy.semantic_identity.len > 0);
    try std.testing.expect(generated_epistemics.semantic_identity.len > 0);
    try std.testing.expect(generated_definition.semantic_identity.len > 0);
    try std.testing.expectEqual(@as(u32, 2), generated_definition.Compiled.Manifest.boundary_machine_abi);
}
