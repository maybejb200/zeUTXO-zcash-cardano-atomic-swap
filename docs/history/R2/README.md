# zeUTXO — shielded ZEC / ADA atomic-swap research

This is the existing R2 development workspace, now registered in place as the primary folder of the local project **zeUTXO**. Registration was confirmed September 26, 2026. Its current path is used by saved launchers and manifests; keep it in place.

Start with `outputs/zeUTXO-PROJECT-GUIDE.md` for the project folder map, saved progress and the next implementation package. `AGENTS.md` supplies persistent working guidance for new tasks opened in this folder.

The latest completed sprint is R2-SETTLEMENT-CORE: compiled escrow setup, joint-owner arming and full-value pre-arm cancellation, with 15 contract checks and eight standalone admission checks passed. Automatic settlement is incomplete; all Armed/Pending exits remain disabled. Do not fund or arm this prototype.

Current development entry points:

- `work/r2/settlement-cardano`: new Cardano contract and build evidence.
- `work/r2/cardano-handoff`: application, owner-policy and admission components.
- `work/r2/refund-native`: native ZEC integration.
- `outputs/R2-COMPLETION-CHECKLIST.md`: stable 12-row progress tracker.
- `outputs/R2-SETTLEMENT-CORE.md`: latest implementation report.
- `work/next-settlement-core-integration.md`: detailed technical handoff.

Project organization was prepared September 26, 2026. This preparation did not resume development or rerun tests. The historical usage figures in sprint reports are not current account readings. Existing conversation history remains in the pinned task named **zeUTXO**; a project folder does not itself copy the full conversation into a new task.
