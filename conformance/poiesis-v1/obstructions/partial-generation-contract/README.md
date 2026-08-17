# Partial-generation contract obstruction

`poiesis-v1-scaffold-r1` corrected the terminal generated-mode contradiction but still required the policy, epistemics, and definition identities to remain stubs until the last writable test file changed. The mandated replacement order changes those identities earlier and requires a full check after each replacement, so the first policy replacement necessarily failed.

The same run then spent its remaining Boundary execution budget searching the admitted repository surface for the Agent v2.6 custom EpistemicStrategy API, which the scaffold did not expose.

The successor keeps the generated flag false during partial generation but permits non-empty intermediate semantic identities, and adds one concise, policy-free Agent API guide. The original r1 tag and failed receipt remain unchanged.
