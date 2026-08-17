# Runtime non-claims

The Poiesis runtime translates the frozen application wire contract and enforces
receiver authority. It does not own release policy, mutate child Memory, author
Frames, infer completion, execute model tool calls, or expose arbitrary paths or
commands.

Poiesis v1 does not claim hostile-host protection, confidentiality of Machine
state, prompt-injection immunity, or exactly-once external execution. Durable
EffectResults provide retry and replay semantics; they do not make external
effects transactional.
