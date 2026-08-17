const std = @import("std");
const contract = @import("release_contract");
const generated_definition = @import("generated_definition");
const generated_policy = @import("generated_policy");
const generated_semantics = @import("generated_semantics");

test "baseline contract and stub shape remain exact" {
    try std.testing.expect(!generated_semantics.generated);
    try std.testing.expectEqualStrings("poiesis_stub_v1", generated_policy.semantic_identity);
    try std.testing.expectEqual(@as(usize, 8), contract.maximum_assertions);
    try std.testing.expectEqual(@as(usize, 6), contract.maximum_mutation_operations);
    try std.testing.expectEqual(@as(u32, 2), generated_definition.Compiled.Manifest.boundary_machine_abi);
    try std.testing.expectEqualStrings("repo.list.v2", contract.ListRepository.semantic_identity);
    try std.testing.expectEqualStrings("repo.read.v2", contract.ReadFile.semantic_identity);
    try std.testing.expectEqualStrings("repo.release-search.v1", contract.SearchAssertion.semantic_identity);
    try std.testing.expectEqualStrings("repo.check.v1", contract.RunCheck.semantic_identity);
    try std.testing.expectEqualStrings("repo.replace.approved.v2", contract.ReplaceFile.semantic_identity);
}

test "generated child identity activates only after parent replacement" {
    if (!generated_semantics.generated) return error.SkipZigTest;
    try std.testing.expect(!std.mem.eql(u8, "poiesis_stub_v1", generated_policy.semantic_identity));
}
