# Epistemics guide signature obstruction

Two independent released-parent attempts reached four approved replacements and then returned typed `capacity_exceeded` while revising `generated_epistemics.zig`. Their first compiler wounds were identical in kind: the immutable guide described `StateSchemaTypes` only as a tuple and did not explicitly forbid comptime values in custom config.

The successor guide adds the exact policy-free tuple signature and requires empty config with comptime values closed over by the implementation type. It supplies no Release Steward observation, admission, final, or test law.
