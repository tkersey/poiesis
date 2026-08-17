const std = @import("std");
const boundary = @import("boundary");
const contract = @import("release_contract");

const Counters = struct {
    turns: u32,
    decisions: u32,
    effect_actions: u32,
    child_actions: u32,
};

const DecisionPhase = enum { decide, propose, reflect };

const DecisionTurn = struct {
    contract_digest: [32]u8,
    goal: contract.Goal,
    counters: Counters,
    phase: DecisionPhase,
    context: contract.DecisionView,
    strategy_local: void,
};

const Emitter = struct {
    writer: *std.Io.Writer,
    allocator: std.mem.Allocator,
    first: bool = true,

    fn emit(
        self: *Emitter,
        name: []const u8,
        kind: []const u8,
        operation: ?[]const u8,
        comptime T: type,
        value: T,
    ) !void {
        const required = try boundary.schema.encodedSize(T, value);
        const encoded = try self.allocator.alloc(u8, required);
        defer self.allocator.free(encoded);
        _ = try boundary.schema.encode(T, value, encoded);
        if (!self.first) try self.writer.writeAll(",\n");
        self.first = false;
        try self.writer.print("    {{\"name\":\"{s}\",\"kind\":\"{s}\"", .{ name, kind });
        if (operation) |label| try self.writer.print(",\"operation\":\"{s}\"", .{label});
        try self.writer.writeAll(",\"hex\":\"");
        for (encoded) |byte| try self.writer.print("{x:0>2}", .{byte});
        try self.writer.writeAll("\"}");
    }
};

fn text(comptime T: type, value: []const u8) !T {
    return T.fromSlice(value);
}

fn digest(character: u8) !contract.DigestHex {
    var bytes = [_]u8{character} ** 64;
    return text(contract.DigestHex, &bytes);
}

fn assertion(query: []const u8, prefix: []const u8, expectation: contract.AssertionExpectation) !contract.ReleaseAssertion {
    return .{
        .query = try text(contract.QueryText, query),
        .path_prefix = try text(contract.Path, prefix),
        .expectation = expectation,
    };
}

fn assertions() !contract.Assertions {
    var values = contract.Assertions.empty();
    try values.push(try assertion("1.0.0", "build.zig.zon", .present));
    try values.push(try assertion("0.9.0", "test/release.zig", .absent));
    return values;
}

fn goal() !contract.Goal {
    return .{
        .task = try text(contract.TaskText, "Reconcile release 1.0.0."),
        .repository = try text(contract.RepositoryLabel, "tkersey/agent"),
        .base_revision = try text(contract.RevisionText, "0123456789abcdef0123456789abcdef01234567"),
        .current_version = try text(contract.VersionText, "0.9.0"),
        .target_version = try text(contract.VersionText, "1.0.0"),
        .assertions = try assertions(),
    };
}

fn snapshot(path_value: []const u8, digest_character: u8, contents: []const u8) !contract.DocumentSnapshot {
    return .{
        .path = try text(contract.Path, path_value),
        .sha256 = try digest(digest_character),
        .contents = try text(contract.FileText, contents),
    };
}

fn listResult(entry_count: usize) !contract.ListResult {
    var entries = contract.ListedFiles.empty();
    for (0..entry_count) |index| {
        var path_buffer: [32]u8 = undefined;
        const path_value = try std.fmt.bufPrint(&path_buffer, "src/file-{d}.zig", .{index});
        try entries.push(.{
            .path = try text(contract.Path, path_value),
            .size_bytes = @intCast(index + 1),
            .writable = index < contract.maximum_changed_files,
        });
    }
    return .{ .entries = entries, .truncated = entry_count == contract.maximum_listed_files };
}

fn searchResult(hit_count: usize, truncated: bool) !contract.AssertionSearchResult {
    var hits = contract.SearchHits.empty();
    for (0..hit_count) |index| {
        var path_buffer: [32]u8 = undefined;
        const path_value = try std.fmt.bufPrint(&path_buffer, "src/file-{d}.zig", .{index});
        try hits.push(.{
            .path = try text(contract.Path, path_value),
            .line = @intCast(index + 1),
            .excerpt = try text(contract.ExcerptText, "literal match"),
        });
    }
    return .{
        .assertion_index = 0,
        .query = try text(contract.QueryText, "1.0.0"),
        .path_prefix = try text(contract.Path, "src"),
        .hits = hits,
        .truncated = truncated,
    };
}

fn changedFiles(count: usize) !contract.ChangedFiles {
    var changed = contract.ChangedFiles.empty();
    for (0..count) |index| {
        var path_buffer: [32]u8 = undefined;
        const path_value = try std.fmt.bufPrint(&path_buffer, "src/file-{d}.zig", .{index});
        try changed.push(try text(contract.Path, path_value));
    }
    return changed;
}

fn mutation() !contract.MutationSummary {
    return .{
        .path = try text(contract.Path, "src/file-0.zig"),
        .old_sha256 = try digest('a'),
        .new_sha256 = try digest('b'),
        .already_applied = false,
    };
}

fn applied() !contract.ReplaceApplied {
    return .{
        .path = try text(contract.Path, "src/file-0.zig"),
        .old_sha256 = try digest('a'),
        .new_sha256 = try digest('b'),
        .already_applied = false,
        .current = try snapshot("src/file-0.zig", 'b', "const version = \"1.0.0\";\n"),
    };
}

fn finalResult() !contract.ReleaseResult {
    return .{
        .summary = try text(contract.SummaryText, "Release identities reconciled."),
        .current_version = try text(contract.VersionText, "0.9.0"),
        .target_version = try text(contract.VersionText, "1.0.0"),
        .changed_files = try changedFiles(2),
        .checks_passed = true,
        .mutation_count = 1,
        .assertions_satisfied = 2,
    };
}

fn emptyView() !contract.DecisionView {
    return .{
        .current_version = try text(contract.VersionText, "0.9.0"),
        .target_version = try text(contract.VersionText, "1.0.0"),
        .assertions = try assertions(),
        .listing = null,
        .documents = contract.Documents.empty(),
        .assertion_evidence = contract.Evidence.empty(),
        .latest_check = null,
        .latest_replace = null,
        .mutations = contract.Mutations.empty(),
        .baseline_check_observed = false,
        .latest_check_passed = false,
        .mutation_count = 0,
        .last_check_mutation_count = 0,
        .check_count = 0,
    };
}

fn populatedView() !contract.DecisionView {
    var documents = contract.Documents.empty();
    try documents.push(try snapshot("src/file-0.zig", 'b', "const version = \"1.0.0\";\n"));
    var evidence = contract.Evidence.empty();
    try evidence.push(.{ .assertion_index = 0, .satisfied = true, .truncated = false, .hit_count = 1, .observed_mutation_count = 1 });
    try evidence.push(.{ .assertion_index = 1, .satisfied = true, .truncated = false, .hit_count = 0, .observed_mutation_count = 1 });
    var mutations = contract.Mutations.empty();
    try mutations.push(try mutation());
    return .{
        .current_version = try text(contract.VersionText, "0.9.0"),
        .target_version = try text(contract.VersionText, "1.0.0"),
        .assertions = try assertions(),
        .listing = try listResult(2),
        .documents = documents,
        .assertion_evidence = evidence,
        .latest_check = .{ .exit_code = 0, .passed = true, .output = try text(contract.CheckOutput, "all checks passed"), .truncated = false },
        .latest_replace = .{ .applied = try applied() },
        .mutations = mutations,
        .baseline_check_observed = true,
        .latest_check_passed = true,
        .mutation_count = 1,
        .last_check_mutation_count = 1,
        .check_count = 2,
    };
}

pub fn main(init: std.process.Init) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();
    var output_buffer: [128 * 1024]u8 = undefined;
    var file_writer = std.Io.File.stdout().writer(init.io, &output_buffer);
    var emitter = Emitter{ .writer = &file_writer.interface, .allocator = allocator };
    try emitter.writer.writeAll("{\n  \"format\":\"poiesis-codec-vectors/v1\",\n  \"vectors\":[\n");

    const initial_goal = try goal();
    const final_value = try finalResult();
    const replace_request = contract.ReplaceRequest{
        .path = try text(contract.Path, "src/main.zig"),
        .expected_sha256 = try digest('a'),
        .replacement = try text(contract.FileText, "const version = \"1.0.0\";\n"),
        .rationale = try text(contract.SummaryText, "Align the release identity."),
    };

    try emitter.emit("initial_goal", "initial_goal", null, contract.Goal, initial_goal);
    try emitter.emit("decision_turn_empty", "decision_turn", null, DecisionTurn, .{ .contract_digest = [_]u8{0xab} ** 32, .goal = initial_goal, .counters = .{ .turns = 0, .decisions = 0, .effect_actions = 0, .child_actions = 0 }, .phase = .decide, .context = try emptyView(), .strategy_local = {} });
    try emitter.emit("decision_turn_populated", "decision_turn", null, DecisionTurn, .{ .contract_digest = [_]u8{0xab} ** 32, .goal = initial_goal, .counters = .{ .turns = 8, .decisions = 8, .effect_actions = 7, .child_actions = 0 }, .phase = .decide, .context = try populatedView(), .strategy_local = {} });

    try emitter.emit("action_list", "action", null, contract.Action, .{ .list_repository = {} });
    try emitter.emit("action_read", "action", null, contract.Action, .{ .read_file = .{ .path = try text(contract.Path, "src/main.zig") } });
    try emitter.emit("action_search", "action", null, contract.Action, .{ .search_assertion = .{ .assertion_index = 0, .query = try text(contract.QueryText, "1.0.0"), .path_prefix = try text(contract.Path, "build.zig.zon") } });
    try emitter.emit("action_check", "action", null, contract.Action, .{ .run_check = .{ .suite = .full } });
    try emitter.emit("action_replace", "action", null, contract.Action, .{ .replace_file = replace_request });
    try emitter.emit("action_final", "action", null, contract.Action, .{ .final = final_value });
    try emitter.emit("action_abort", "action", null, contract.Action, .{ .abort = .authored_abort });
    try emitter.emit("final_result", "final_result", null, contract.ReleaseResult, final_value);

    try emitter.emit("payload_list", "payload", "list", void, {});
    try emitter.emit("payload_read", "payload", "read", contract.ReadRequest, .{ .path = try text(contract.Path, "src/main.zig") });
    try emitter.emit("payload_search", "payload", "search", contract.AssertionSearchRequest, .{ .assertion_index = 0, .query = try text(contract.QueryText, "1.0.0"), .path_prefix = try text(contract.Path, "build.zig.zon") });
    try emitter.emit("payload_check", "payload", "check", contract.CheckRequest, .{ .suite = .full });
    try emitter.emit("payload_replace", "payload", "replace", contract.ReplaceRequest, replace_request);

    const list_empty = try listResult(0);
    const list_maximum = try listResult(contract.maximum_listed_files);
    const read_result = try snapshot("src/main.zig", 'b', "const version = \"1.0.0\";\n");
    const search_present = try searchResult(1, false);
    const search_absent = try searchResult(0, false);
    const search_truncated = try searchResult(contract.maximum_search_hits, true);
    const check_positive = contract.CheckResult{ .exit_code = 0, .passed = true, .output = try text(contract.CheckOutput, "all checks passed"), .truncated = false };
    const check_negative = contract.CheckResult{ .exit_code = -7, .passed = false, .output = try text(contract.CheckOutput, "check failed"), .truncated = true };
    const replace_applied = contract.ReplaceOutcome{ .applied = try applied() };
    const replace_denied = contract.ReplaceOutcome{ .denied = .{ .path = try text(contract.Path, "src/main.zig"), .reason = try text(contract.ReasonText, "not writable") } };
    const replace_conflict = contract.ReplaceOutcome{ .conflict = .{ .path = try text(contract.Path, "src/main.zig"), .expected_sha256 = try digest('a'), .actual_sha256 = try digest('c') } };

    try emitter.emit("result_list_empty", "result", "list", contract.ListResult, list_empty);
    try emitter.emit("result_list_maximum", "result", "list", contract.ListResult, list_maximum);
    try emitter.emit("result_read", "result", "read", contract.ReadResult, read_result);
    try emitter.emit("result_search_present", "result", "search", contract.AssertionSearchResult, search_present);
    try emitter.emit("result_search_absent", "result", "search", contract.AssertionSearchResult, search_absent);
    try emitter.emit("result_search_truncated", "result", "search", contract.AssertionSearchResult, search_truncated);
    try emitter.emit("result_check_positive", "result", "check", contract.CheckResult, check_positive);
    try emitter.emit("result_check_negative", "result", "check", contract.CheckResult, check_negative);
    try emitter.emit("result_replace_applied", "result", "replace", contract.ReplaceOutcome, replace_applied);
    try emitter.emit("result_replace_denied", "result", "replace", contract.ReplaceOutcome, replace_denied);
    try emitter.emit("result_replace_conflict", "result", "replace", contract.ReplaceOutcome, replace_conflict);

    try emitter.emit("observation_list", "observation", null, contract.Observation, .{ .list_repository = list_empty });
    try emitter.emit("observation_read", "observation", null, contract.Observation, .{ .read_file = read_result });
    try emitter.emit("observation_search", "observation", null, contract.Observation, .{ .search_assertion = search_present });
    try emitter.emit("observation_check", "observation", null, contract.Observation, .{ .run_check = check_positive });
    try emitter.emit("observation_replace", "observation", null, contract.Observation, .{ .replace_file = replace_applied });

    try emitter.writer.writeAll("\n  ]\n}\n");
    try emitter.writer.flush();
}
