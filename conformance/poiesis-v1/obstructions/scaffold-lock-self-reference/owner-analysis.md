# Owner analysis

Classification: `capability_obstruction`

Owner: Poiesis scaffold-freeze tooling.

The obstruction is not owned by Praxis, Agent, Boundary, World, world-host, or world-capabilities. None of those systems chooses the contents or Git location of the Poiesis scaffold lock. The child profile and provider are also uninvolved.

The application-local requirement is inexpressible through the literal one-commit representation because the commit identity depends on a file that must already contain that identity. Adding a registry, mutable tag, placeholder digest, post-hoc rewrite, Git shim, or weaker symbolic reference would destroy the exact immutable evidence the lock exists to provide.

The smallest semantic change is a Poiesis-local two-layer representation: immutable scaffold object **A**, followed by evidence object **B** that names **A**. Birth still targets **A**, so there is no compatibility, authority, Machine, runtime, ABI, or protocol change.

The original one-commit tuple is retained as failed. It is not rewritten as successful.
