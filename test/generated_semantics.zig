const std = @import("std");
const generated_definition = @import("generated_definition");
const generated_epistemics = @import("generated_epistemics");
const generated_policy = @import("generated_policy");

pub const generated = false;

test "scaffold semantic files remain explicit compilable stubs" {
    try std.testing.expectEqualStrings("poiesis_stub_v1", generated_policy.semantic_identity);
    try std.testing.expectEqualStrings("poiesis_stub_v1", generated_epistemics.semantic_identity);
    try std.testing.expectEqualStrings("poiesis_stub_v1", generated_definition.semantic_identity);
    try std.testing.expectEqual(@as(u32, 2), generated_definition.Compiled.Manifest.boundary_machine_abi);
}
