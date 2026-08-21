# Generated module closure

Scaffold r12 instructed parent-authored epistemics to import
`working_set_helpers`, and the live generated file did so extensively. The
build graph did not provide that import to the generated epistemics module. It
also did not expose `generated_policy`, preventing the parent from distributing
its own application-specific lowering across the two available generated
semantic slots.

The r12 live attempt terminated earlier at an exact-bound EOF parse error, so
Zig did not reach module resolution. Repository inspection nevertheless proves
that any syntactically completed r12 epistemics using the documented helper
would fail with an unavailable module.

Scaffold r13 closes the build graph, proves the imports through compilable
stubs, and explicitly permits parent-authored shared lowering in generated
policy. It adds no child semantics, writable file, authority, or capacity.
