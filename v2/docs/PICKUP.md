# Existing drop pickup

`pickup` is the only new action. `pickup:{entityId,expected:itemName}` selects one current `visibleItems` entry. Each entry includes item name/count, entity ID and current position, filtered through the same FOV/raycast visibility used for other entities. IDs are session-local; no unseen item locations or expected loot tables enter model input.

Plan parsing, medium-step activation, candidates, provider action descriptions, runtime failure identity, structured journal and persistent experience records carry this parameter/evidence. The model selects the target; local code approaches and collects. No extra look/approach/wait actions are exposed for the collection sequence.

`mine` retains its two-second automatic pickup phase. Both actions call the same `collectVisibleDrop` movement helper: validate a visible item, inspect ground, navigate to its cell, stop on cancellation or visible danger, and clean up movement/listeners. Standalone pickup has an eight-second internal bound (the runtime can impose a shorter bound), cancels on own health loss, then waits briefly for inventory packets. It does not chase moving drops indefinitely or clear obstacles automatically. Inventory-full/unreachable/missing-target cases do not imply successful receipt.

Result is `kind:pickup`, target, status, elapsedMs, detail and measured `inventoryGained`. Success requires a positive gain of the requested item. Other gains are recorded but cannot complete the target action. Entity disappearance alone is never receipt. Matching inventory gain is still not causal proof that this exact entity supplied it; unrelated same-item pickups remain possible. There is no ownership/claim protocol or recipient acknowledgement yet. No claim of general item delivery from a pickup alone.

## Verification, 2026-10-17

Typecheck and118 offline tests pass (`runs/pickup-tests.log`). Coverage includes parser/step propagation, candidate visibility/danger, actual matching gain, disappearing target without gain, unrelated gain, damage/danger interruption and runtime structured journal. Existing mine regression tests exercise the shared helper.

Live Bob-only deterministic functional probe: `node --import tsx scripts/pickup-functional.ts --live-functional`. Requires administrator-prepared safe drop; hard limit60s, no model providers/API calls. Evidence: `runs/pickup-1792223689565/events.jsonl`, `runs/pickup-live.log`. Spawn16:54:50 KST, target2046 visible at(31.5,-60,0.5), pickup finished16:54:59.850 in1056ms, cobblestone2->3; retry of disappeared target failed in1ms with gain0; disconnected16:54:59.892. HP20 throughout. Server report retained privately in runs/pickup-admin-report.txt.

Only ordinary existing-drop pickup was live tested. Model selection/prompt use is wired but no paid model inference was run. Two-player handoff, full-inventory server case, moving/merging drops and long navigation remain unverified. No main experiment or paid API call.

## Next discussion (not implemented)

Prefer extending existing actions over adding many primitives: generalize deposit from logs to explicit item/count at a visible chest, then verify a two-bot chest handoff. Separately add evidence-based acknowledgement of give/pickup to social commitments without creating another action. Leave autonomous building design to ordinary planning rather than injecting a house goal.
