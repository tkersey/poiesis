const std = @import("std");
const boundary = @import("boundary");
const contract = @import("release_contract");

const Parsed = struct {
    task_file: []const u8,
    goal_file: []const u8,
    repository: []const u8,
    base_revision: []const u8,
};

const AssertionDocument = struct {
    query: []const u8,
    path_prefix: []const u8,
    expectation: contract.AssertionExpectation,
};

const GoalDocument = struct {
    format: []const u8,
    current_version: []const u8,
    target_version: []const u8,
    assertions: []const AssertionDocument,
};

fn parseArgs(raw: []const []const u8) !Parsed {
    var parsed: struct {
        task_file: ?[]const u8 = null,
        goal_file: ?[]const u8 = null,
        repository: ?[]const u8 = null,
        base_revision: ?[]const u8 = null,
    } = .{};
    var index: usize = 0;
    while (index < raw.len) : (index += 2) {
        if (index + 1 >= raw.len) return error.InvalidArguments;
        const name = raw[index];
        const value = raw[index + 1];
        if (std.mem.eql(u8, name, "--task-file")) {
            if (parsed.task_file != null) return error.InvalidArguments;
            parsed.task_file = value;
        } else if (std.mem.eql(u8, name, "--goal-file")) {
            if (parsed.goal_file != null) return error.InvalidArguments;
            parsed.goal_file = value;
        } else if (std.mem.eql(u8, name, "--repository")) {
            if (parsed.repository != null) return error.InvalidArguments;
            parsed.repository = value;
        } else if (std.mem.eql(u8, name, "--base-revision")) {
            if (parsed.base_revision != null) return error.InvalidArguments;
            parsed.base_revision = value;
        } else return error.InvalidArguments;
    }
    return .{
        .task_file = parsed.task_file orelse return error.InvalidArguments,
        .goal_file = parsed.goal_file orelse return error.InvalidArguments,
        .repository = parsed.repository orelse return error.InvalidArguments,
        .base_revision = parsed.base_revision orelse return error.InvalidArguments,
    };
}

fn validRevision(value: []const u8) bool {
    if (value.len != 40) return false;
    for (value) |byte| switch (byte) {
        '0'...'9', 'a'...'f' => {},
        else => return false,
    };
    return true;
}

fn admittedText(comptime T: type, value: []const u8) !T {
    if (!std.unicode.utf8ValidateSlice(value)) return error.InvalidArguments;
    return T.fromSlice(value) catch return error.InvalidArguments;
}

fn makeGoal(task: []const u8, document: GoalDocument, repository: []const u8, revision: []const u8) !contract.Goal {
    if (!std.mem.eql(u8, document.format, "poiesis-goal/v1") or
        task.len == 0 or repository.len == 0 or
        document.current_version.len == 0 or document.target_version.len == 0 or
        std.mem.eql(u8, document.current_version, document.target_version) or
        !validRevision(revision) or document.assertions.len == 0 or
        document.assertions.len > contract.maximum_assertions) return error.InvalidArguments;
    var assertions = contract.Assertions.empty();
    for (document.assertions) |value| {
        if (value.query.len == 0 or value.path_prefix.len == 0) return error.InvalidArguments;
        try assertions.push(.{
            .query = try admittedText(contract.QueryText, value.query),
            .path_prefix = try admittedText(contract.Path, value.path_prefix),
            .expectation = value.expectation,
        });
    }
    return .{
        .task = try admittedText(contract.TaskText, task),
        .repository = try admittedText(contract.RepositoryLabel, repository),
        .base_revision = try admittedText(contract.RevisionText, revision),
        .current_version = try admittedText(contract.VersionText, document.current_version),
        .target_version = try admittedText(contract.VersionText, document.target_version),
        .assertions = assertions,
    };
}

pub fn main(init: std.process.Init) !void {
    var arena = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena.deinit();
    const allocator = arena.allocator();

    var iterator = std.process.Args.Iterator.init(init.minimal.args);
    _ = iterator.next();
    var raw: [8][]const u8 = undefined;
    var count: usize = 0;
    while (iterator.next()) |arg| {
        if (count == raw.len) return error.InvalidArguments;
        raw[count] = arg;
        count += 1;
    }
    const parsed = try parseArgs(raw[0..count]);
    const task = try std.Io.Dir.cwd().readFileAlloc(init.io, parsed.task_file, allocator, .limited(8 * 1024 + 1));
    const goal_json = try std.Io.Dir.cwd().readFileAlloc(init.io, parsed.goal_file, allocator, .limited(16 * 1024 + 1));
    const document = try std.json.parseFromSlice(GoalDocument, allocator, goal_json, .{});
    defer document.deinit();
    const goal = try makeGoal(task, document.value, parsed.repository, parsed.base_revision);
    const required = try boundary.schema.encodedSize(contract.Goal, goal);
    if (required > 16 * 1024) return error.InvalidArguments;
    const encoded = try allocator.alloc(u8, required);
    _ = try boundary.schema.encode(contract.Goal, goal, encoded);
    var output_buffer: [16 * 1024]u8 = undefined;
    var output = std.Io.File.stdout().writer(init.io, &output_buffer);
    try output.interface.writeAll(encoded);
    try output.interface.flush();
}

test "argument parser accepts each required flag exactly once" {
    const parsed = try parseArgs(&.{
        "--repository",
        "tkersey/agent",
        "--task-file",
        "task.md",
        "--base-revision",
        "0123456789abcdef0123456789abcdef01234567",
        "--goal-file",
        "goal.json",
    });
    try std.testing.expectEqualStrings("task.md", parsed.task_file);
    try std.testing.expectEqualStrings("goal.json", parsed.goal_file);
    try std.testing.expectEqualStrings("tkersey/agent", parsed.repository);
}

test "argument parser rejects missing duplicate unknown and extra arguments" {
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{ "--task-file", "task.md" }));
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{ "--unknown", "value" }));
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{
        "--task-file", "one", "--task-file", "two", "--goal-file", "goal.json", "--repository", "repo", "--base-revision", "0123456789abcdef0123456789abcdef01234567",
    }));
    try std.testing.expectError(error.InvalidArguments, parseArgs(&.{"--task-file"}));
}

test "goal admission enforces closed JSON shape and semantic bounds" {
    const valid_json =
        \\{"format":"poiesis-goal/v1","current_version":"0.9.0","target_version":"1.0.0","assertions":[{"query":"1.0.0","path_prefix":"build.zig.zon","expectation":"present"}]}
    ;
    var parsed = try std.json.parseFromSlice(GoalDocument, std.testing.allocator, valid_json, .{});
    defer parsed.deinit();
    const revision = "0123456789abcdef0123456789abcdef01234567";
    const admitted = try makeGoal("Release 1.0.0", parsed.value, "tkersey/agent", revision);
    try std.testing.expectEqual(@as(u32, 1), try admitted.assertions.len());
    try std.testing.expectError(error.InvalidArguments, makeGoal("Release", parsed.value, "tkersey/agent", "abc"));

    const unknown_json =
        \\{"format":"poiesis-goal/v1","current_version":"0.9.0","target_version":"1.0.0","assertions":[],"extra":true}
    ;
    try std.testing.expectError(error.UnknownField, std.json.parseFromSlice(GoalDocument, std.testing.allocator, unknown_json, .{}));
}
