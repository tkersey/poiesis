const boundary = @import("boundary");

pub const maximum_listed_files = 64;
pub const maximum_documents = 12;
pub const maximum_search_hits = 24;
pub const maximum_assertions = 8;
pub const maximum_mutation_operations = 6;
pub const maximum_changed_files = 4;

pub const Path = boundary.Text(256);
pub const TaskText = boundary.Text(8 * 1024);
pub const RepositoryLabel = boundary.Text(128);
pub const RevisionText = boundary.Text(64);
pub const VersionText = boundary.Text(64);
pub const QueryText = boundary.Text(256);
pub const ExcerptText = boundary.Text(512);
pub const FileText = boundary.Text(16 * 1024);
pub const CheckOutput = boundary.Text(16 * 1024);
pub const SummaryText = boundary.Text(4 * 1024);
pub const ReasonText = boundary.Text(512);
pub const DigestHex = boundary.Text(64);

pub const AssertionExpectation = enum { present, absent };

pub const ReleaseAssertion = struct {
    query: QueryText,
    path_prefix: Path,
    expectation: AssertionExpectation,
};

pub const Assertions = boundary.Vector(ReleaseAssertion, maximum_assertions);

pub const Goal = struct {
    task: TaskText,
    repository: RepositoryLabel,
    base_revision: RevisionText,
    current_version: VersionText,
    target_version: VersionText,
    assertions: Assertions,
};

pub const FileEntry = struct { path: Path, size_bytes: u32, writable: bool };
pub const ListedFiles = boundary.Vector(FileEntry, maximum_listed_files);
pub const ListResult = struct { entries: ListedFiles, truncated: bool };
pub const ReadRequest = struct { path: Path };
pub const DocumentSnapshot = struct { path: Path, sha256: DigestHex, contents: FileText };
pub const ReadResult = DocumentSnapshot;

pub const AssertionSearchRequest = struct {
    assertion_index: u8,
    query: QueryText,
    path_prefix: Path,
};

pub const SearchHit = struct { path: Path, line: u32, excerpt: ExcerptText };
pub const SearchHits = boundary.Vector(SearchHit, maximum_search_hits);
pub const AssertionSearchResult = struct {
    assertion_index: u8,
    query: QueryText,
    path_prefix: Path,
    hits: SearchHits,
    truncated: bool,
};

pub const CheckSuite = enum { full };
pub const CheckRequest = struct { suite: CheckSuite };
pub const CheckResult = struct {
    exit_code: i32,
    passed: bool,
    output: CheckOutput,
    truncated: bool,
};

pub const ReplaceRequest = struct {
    path: Path,
    expected_sha256: DigestHex,
    replacement: FileText,
    rationale: SummaryText,
};

pub const ReplaceApplied = struct {
    path: Path,
    old_sha256: DigestHex,
    new_sha256: DigestHex,
    already_applied: bool,
    current: DocumentSnapshot,
};
pub const ReplaceDenied = struct { path: Path, reason: ReasonText };
pub const ReplaceConflict = struct { path: Path, expected_sha256: DigestHex, actual_sha256: DigestHex };
pub const ReplaceOutcome = union(enum) { applied: ReplaceApplied, denied: ReplaceDenied, conflict: ReplaceConflict };

pub const ChangedFiles = boundary.Vector(Path, maximum_changed_files);
pub const ReleaseResult = struct {
    summary: SummaryText,
    current_version: VersionText,
    target_version: VersionText,
    changed_files: ChangedFiles,
    checks_passed: bool,
    mutation_count: u32,
    assertions_satisfied: u8,
};

pub const Failure = enum {
    budget_exhausted,
    arithmetic_overflow,
    invalid_index,
    invalid_variant,
    capacity_exceeded,
    authored_abort,
};

pub const Action = union(enum) {
    list_repository: void,
    read_file: ReadRequest,
    search_assertion: AssertionSearchRequest,
    run_check: CheckRequest,
    replace_file: ReplaceRequest,
    final: ReleaseResult,
    abort: Failure,
};

pub const Observation = union(enum) {
    list_repository: ListResult,
    read_file: ReadResult,
    search_assertion: AssertionSearchResult,
    run_check: CheckResult,
    replace_file: ReplaceOutcome,
};

pub const ListRepository = boundary.effect.site(1, "repo.list.v2", void, ListResult);
pub const ReadFile = boundary.effect.site(2, "repo.read.v2", ReadRequest, ReadResult);
pub const SearchAssertion = boundary.effect.site(3, "repo.release-search.v1", AssertionSearchRequest, AssertionSearchResult);
pub const RunCheck = boundary.effect.site(4, "repo.check.v1", CheckRequest, CheckResult);
pub const ReplaceFile = boundary.effect.site(5, "repo.replace.approved.v2", ReplaceRequest, ReplaceOutcome);

pub const MutationSummary = struct {
    path: Path,
    old_sha256: DigestHex,
    new_sha256: DigestHex,
    already_applied: bool,
};

pub const AssertionEvidence = struct {
    assertion_index: u8,
    satisfied: bool,
    truncated: bool,
    hit_count: u32,
    observed_mutation_count: u32,
};

pub const Documents = boundary.Vector(DocumentSnapshot, maximum_documents);
pub const Mutations = boundary.Vector(MutationSummary, maximum_mutation_operations);
pub const Evidence = boundary.Vector(AssertionEvidence, maximum_assertions);

pub const Memory = struct {
    current_version: VersionText,
    target_version: VersionText,
    assertions: Assertions,
    listing: ?ListResult,
    documents: Documents,
    assertion_evidence: Evidence,
    latest_check: ?CheckResult,
    latest_replace: ?ReplaceOutcome,
    mutations: Mutations,
    baseline_check_observed: bool,
    latest_check_passed: bool,
    mutation_count: u32,
    last_check_mutation_count: u32,
    check_count: u32,
};

pub const DecisionView = struct {
    current_version: VersionText,
    target_version: VersionText,
    assertions: Assertions,
    listing: ?ListResult,
    documents: Documents,
    assertion_evidence: Evidence,
    latest_check: ?CheckResult,
    latest_replace: ?ReplaceOutcome,
    mutations: Mutations,
    baseline_check_observed: bool,
    latest_check_passed: bool,
    mutation_count: u32,
    last_check_mutation_count: u32,
    check_count: u32,
};

test "release contract preserves the v1 bounds" {
    const std = @import("std");
    try std.testing.expectEqual(@as(usize, 64), maximum_listed_files);
    try std.testing.expectEqual(@as(usize, 12), maximum_documents);
    try std.testing.expectEqual(@as(usize, 8), maximum_assertions);
    try std.testing.expectEqual(@as(usize, 6), maximum_mutation_operations);
    try std.testing.expectEqual(@as(usize, 4), maximum_changed_files);
}
