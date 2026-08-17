const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});
    const agent_dependency = b.dependency("agent", .{
        .target = target,
        .optimize = optimize,
    });
    const world_dependency = b.dependency("world", .{
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

    const application_module = createApplicationModule(
        b,
        target,
        optimize,
        agent_dependency.module("agent"),
        agent_dependency.module("boundary"),
        world_dependency.module("world"),
        definition_module,
    );
    addTestStep(b, check, application_module);

    const wasm_target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
        .abi = .none,
    });
    const wasm_agent_dependency = b.dependency("agent", .{
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });
    const wasm_world_dependency = b.dependency("world", .{
        .target = wasm_target,
        .optimize = .ReleaseFast,
    });
    const wasm_definition = createDefinitionModule(
        b,
        wasm_target,
        .ReleaseFast,
        wasm_agent_dependency.module("agent"),
        wasm_agent_dependency.module("boundary"),
    );
    const wasm_application = createApplicationModule(
        b,
        wasm_target,
        .ReleaseFast,
        wasm_agent_dependency.module("agent"),
        wasm_agent_dependency.module("boundary"),
        wasm_world_dependency.module("world"),
        wasm_definition,
    );
    const wasm = b.addExecutable(.{
        .name = "release-steward.world",
        .root_module = b.createModule(.{
            .root_source_file = b.path("scaffold/wasm_main.zig"),
            .target = wasm_target,
            .optimize = .ReleaseFast,
            .imports = &.{
                .{ .name = "poiesis_application", .module = wasm_application },
                .{ .name = "world", .module = wasm_world_dependency.module("world") },
            },
        }),
    });
    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.export_memory = true;
    wasm.stack_size = 128 * 1024 * 1024;
    wasm.initial_memory = @as(u64, 4096) * 64 * 1024;
    wasm.max_memory = @as(u64, 4096) * 64 * 1024;

    const pack_wasm = b.addSystemCommand(&.{"node"});
    pack_wasm.addFileArg(wasm_agent_dependency.path("tools/adequacy/sparse-wasm-data.mjs"));
    pack_wasm.addFileArg(wasm.getEmittedBin());
    const packed_wasm = pack_wasm.addOutputFileArg("release-steward.world.wasm");

    const manifest_emitter = b.addExecutable(.{
        .name = "release-steward-manifest",
        .root_module = b.createModule(.{
            .root_source_file = world_dependency.path("src/application_manifest_emit_v1.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{.{ .name = "world_application", .module = application_module }},
        }),
    });
    const run_manifest = b.addRunArtifact(manifest_emitter);
    const manifest = run_manifest.addOutputFileArg("release-steward.manifest.bin");
    const manifest_text = run_manifest.addOutputFileArg("release-steward.manifest.txt");

    const contract_json = addContractEmitter(b, "emit-release-steward-contract-json", false, agent_dependency.module("agent"), definition_module);
    const contract_json_output = b.addRunArtifact(contract_json).captureStdOut(.{
        .basename = "release-steward.decision-contract.json",
    });
    const contract_binary = addContractEmitter(b, "emit-release-steward-contract-binary", true, agent_dependency.module("agent"), definition_module);
    const contract_binary_output = b.addRunArtifact(contract_binary).captureStdOut(.{
        .basename = "release-steward.decision-contract.bin",
    });

    const binding_manifest = b.addExecutable(.{
        .name = "emit-release-steward-binding-manifest",
        .root_module = b.createModule(.{
            .root_source_file = b.path("scaffold/emit_binding_manifest.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "boundary", .module = agent_dependency.module("boundary") },
                .{ .name = "poiesis_application", .module = application_module },
                .{ .name = "world", .module = world_dependency.module("world") },
            },
        }),
    });
    const binding_manifest_output = b.addRunArtifact(binding_manifest).captureStdOut(.{
        .basename = "release-steward.binding-manifest.json",
    });

    const codec_vectors = b.addExecutable(.{
        .name = "emit-release-steward-codec-vectors",
        .root_module = b.createModule(.{
            .root_source_file = b.path("scaffold/emit_codec_vectors.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "boundary", .module = agent_dependency.module("boundary") },
                .{ .name = "release_contract", .module = contract_module },
            },
        }),
    });
    codec_vectors.stack_size = 1024 * 1024 * 1024;
    const codec_vectors_output = b.addRunArtifact(codec_vectors).captureStdOut(.{
        .basename = "release-steward.codec-vectors.json",
    });

    const initial_args_module = b.createModule(.{
        .root_source_file = b.path("scaffold/emit_initial_args.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "boundary", .module = agent_dependency.module("boundary") },
            .{ .name = "release_contract", .module = contract_module },
        },
    });
    const initial_args = b.addExecutable(.{
        .name = "poiesis-initial-args",
        .root_module = initial_args_module,
    });
    const initial_args_tests = b.addTest(.{ .root_module = initial_args_module });
    const run_initial_args_tests = b.addRunArtifact(initial_args_tests);

    const artifact_check = b.addSystemCommand(&.{"node"});
    artifact_check.addFileArg(wasm_world_dependency.path("scripts/world_application_v1_artifact_check.mjs"));
    artifact_check.addFileArg(packed_wasm);
    artifact_check.addFileArg(manifest);
    artifact_check.addArg("4096");
    artifact_check.addArg("4096");

    const install_wasm = b.addInstallFile(packed_wasm, "release-steward/release-steward.world.wasm");
    install_wasm.step.dependOn(&artifact_check.step);
    const install_manifest = b.addInstallFile(manifest, "release-steward/release-steward.manifest.bin");
    install_manifest.step.dependOn(&artifact_check.step);
    const install_manifest_text = b.addInstallFile(manifest_text, "release-steward/release-steward.manifest.txt");
    const install_contract_json = b.addInstallFile(contract_json_output, "release-steward/release-steward.decision-contract.json");
    const install_contract_binary = b.addInstallFile(contract_binary_output, "release-steward/release-steward.decision-contract.bin");
    const install_binding_manifest = b.addInstallFile(binding_manifest_output, "release-steward/release-steward.binding-manifest.json");
    const install_codec_vectors = b.addInstallFile(codec_vectors_output, "release-steward/release-steward.codec-vectors.json");
    const install_initial_args = b.addInstallArtifact(initial_args, .{});

    check.dependOn(&artifact_check.step);
    check.dependOn(&install_wasm.step);
    check.dependOn(&install_manifest.step);
    check.dependOn(&install_manifest_text.step);
    check.dependOn(&install_contract_json.step);
    check.dependOn(&install_contract_binary.step);
    check.dependOn(&install_binding_manifest.step);
    check.dependOn(&install_codec_vectors.step);
    check.dependOn(&run_initial_args_tests.step);
    check.dependOn(&install_initial_args.step);

    b.getInstallStep().dependOn(&install_wasm.step);
    b.getInstallStep().dependOn(&install_manifest.step);
    b.getInstallStep().dependOn(&install_manifest_text.step);
    b.getInstallStep().dependOn(&install_contract_json.step);
    b.getInstallStep().dependOn(&install_contract_binary.step);
    b.getInstallStep().dependOn(&install_binding_manifest.step);
    b.getInstallStep().dependOn(&install_codec_vectors.step);
    b.getInstallStep().dependOn(&install_initial_args.step);
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

fn createDefinitionModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    agent: *std.Build.Module,
    boundary: *std.Build.Module,
) *std.Build.Module {
    const policy = b.createModule(.{
        .root_source_file = b.path("src/generated_policy.zig"),
        .target = target,
        .optimize = optimize,
    });
    const epistemics = b.createModule(.{
        .root_source_file = b.path("src/generated_epistemics.zig"),
        .target = target,
        .optimize = optimize,
    });
    const contract = b.createModule(.{
        .root_source_file = b.path("scaffold/release_contract.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{.{ .name = "boundary", .module = boundary }},
    });
    return b.createModule(.{
        .root_source_file = b.path("src/generated_definition.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent },
            .{ .name = "boundary", .module = boundary },
            .{ .name = "generated_epistemics", .module = epistemics },
            .{ .name = "generated_policy", .module = policy },
            .{ .name = "release_contract", .module = contract },
        },
    });
}

fn createApplicationModule(
    b: *std.Build,
    target: std.Build.ResolvedTarget,
    optimize: std.builtin.OptimizeMode,
    agent: *std.Build.Module,
    boundary: *std.Build.Module,
    world: *std.Build.Module,
    definition: *std.Build.Module,
) *std.Build.Module {
    return b.createModule(.{
        .root_source_file = b.path("scaffold/application.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "agent", .module = agent },
            .{ .name = "boundary", .module = boundary },
            .{ .name = "generated_definition", .module = definition },
            .{ .name = "world", .module = world },
        },
    });
}

fn addContractEmitter(
    b: *std.Build,
    name: []const u8,
    binary: bool,
    agent: *std.Build.Module,
    definition: *std.Build.Module,
) *std.Build.Step.Compile {
    const options = b.addOptions();
    options.addOption(bool, "binary", binary);
    return b.addExecutable(.{
        .name = name,
        .root_module = b.createModule(.{
            .root_source_file = b.path("scaffold/emit_decision_contract.zig"),
            .target = b.graph.host,
            .optimize = .ReleaseSafe,
            .imports = &.{
                .{ .name = "agent", .module = agent },
                .{ .name = "emit_contract_options", .module = options.createModule() },
                .{ .name = "generated_definition", .module = definition },
            },
        }),
    });
}
