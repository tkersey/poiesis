const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const agent_dependency = b.dependency("agent", .{
        .target = target,
        .optimize = optimize,
    });

    const policy_module = b.createModule(.{
        .root_source_file = b.path("src/generated_policy.zig"),
        .target = target,
        .optimize = optimize,
    });
    const epistemics_module = b.createModule(.{
        .root_source_file = b.path("src/generated_epistemics.zig"),
        .target = target,
        .optimize = optimize,
    });
    const contract_module = b.createModule(.{
        .root_source_file = b.path("scaffold/release_contract.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = agent_dependency.module("boundary") },
        },
    });
    const definition_module = b.createModule(.{
        .root_source_file = b.path("src/generated_definition.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent_dependency.module("agent") },
            .{ .name = "boundary", .module = agent_dependency.module("boundary") },
            .{ .name = "generated_epistemics", .module = epistemics_module },
            .{ .name = "generated_policy", .module = policy_module },
            .{ .name = "release_contract", .module = contract_module },
        },
    });
    const visible_semantics_module = b.createModule(.{
        .root_source_file = b.path("test/generated_semantics.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "generated_definition", .module = definition_module },
            .{ .name = "generated_epistemics", .module = epistemics_module },
            .{ .name = "generated_policy", .module = policy_module },
        },
    });

    const check = b.step("check", "Run the Agent Poiesis credential-free Zig checks");
    addTestStep(b, check, visible_semantics_module);
    addHiddenTest(b, check, "scaffold/test/hidden_child_contract.zig", contract_module, definition_module, policy_module, visible_semantics_module, target, optimize);
    addHiddenTest(b, check, "scaffold/test/hidden_action_admission.zig", contract_module, definition_module, policy_module, visible_semantics_module, target, optimize);
    addHiddenTest(b, check, "scaffold/test/hidden_final_admission.zig", contract_module, definition_module, policy_module, visible_semantics_module, target, optimize);
}

fn addHiddenTest(
    b: *std.Build,
    check: *std.Build.Step,
    path: []const u8,
    contract_module: *std.Build.Module,
    definition_module: *std.Build.Module,
    policy_module: *std.Build.Module,
    visible_semantics_module: *std.Build.Module,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
) void {
    const module = b.createModule(.{
        .root_source_file = b.path(path),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "generated_definition", .module = definition_module },
            .{ .name = "generated_policy", .module = policy_module },
            .{ .name = "generated_semantics", .module = visible_semantics_module },
            .{ .name = "release_contract", .module = contract_module },
        },
    });
    addTestStep(b, check, module);
}

fn addTestStep(b: *std.Build, check: *std.Build.Step, module: *std.Build.Module) void {
    const tests = b.addTest(.{ .root_module = module });
    tests.stack_size = 1024 * 1024 * 1024;
    check.dependOn(&b.addRunArtifact(tests).step);
}
