# Owner analysis

Classification: `capability_obstruction`

Owner: Poiesis build graph and generated-source layout contract.

The immutable guide named a module the build did not supply. The same build
kept the policy and epistemics modules isolated even though both are
parent-authored semantic source and together provide the declared bounded
capacity. Agent, Boundary, World, Praxis, the provider, and workspace
capabilities do not own Zig module imports for this repository.

The smallest correction is ordinary module closure: supply
`working_set_helpers` to both generated modules, supply `generated_policy` to
generated epistemics, and reference both imports from the stubs so baseline CI
proves the edge. The parent still authors all application laws and all four
writable files.
