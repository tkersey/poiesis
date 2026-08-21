# Release Steward birth v1.0.5 model loop

Praxis v1.0.5 corrected the v1.0.4 replacement-budget authority split: the model-visible instructions, Machine, codec, workspace adapter, and Poiesis policy all admit ten replacements. The earlier v1.0.4 `capacity_exceeded` results therefore remain historical failed-tuple evidence, not proof of model incapability under a coherent ten-replacement tuple.

Two independent clean births then ran from `poiesis-v1-scaffold-r10` with receiver-selected `gpt-5.6-sol`. Both authenticated the same frozen Praxis v1.0.5 parent, passed baseline validation, changed only the admitted semantic slots, and stopped before completing the four-file child.

The first attempt applied three replacements across policy and epistemics. Its epistemics file reached exactly 16 KiB and was syntactically incomplete. The model then proposed another epistemics replacement without first running the required fresh check, so typed action admission terminated with `invalid_variant` before a fourth write.

The second attempt applied and checked two replacements across policy and epistemics. Its distinct epistemics file also reached exactly 16 KiB. The model then requested the same current epistemics snapshot eighteen consecutive times until the parent failed closed at its 16,000,000-instruction Machine budget.

No human generated-source edit, hidden implementation, unauthorized write, or reference solution was supplied. A third unchanged run with the same model is excluded by `NEG-000007`. The smallest remaining experiment is a receiver-selected different exact model against the unchanged frozen parent and scaffold.
