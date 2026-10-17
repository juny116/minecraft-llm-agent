# Unified mining and outcome evidence

`mine` replaces BOTH `gather` and `dig_block`. They are no longer selectable actions or accepted new plans. No implicit wood target remains: LLM plans specify `mine:{position:{x,y,z},expected:blockName,maxMs?,tool?,toolSlot?}`. The candidate requires that exact currently visible block. The executor rechecks its state, line of sight, reach and own-floor safety, equips a carried tool and calls normal Mineflayer `dig`. It does not delete blocks with commands or generate code. `place_block` is unchanged; no mandatory house objective is added.

## Timing and tool selection

Default attempt budget is30,000ms; the planner can request1,000–120,000ms. This measures the actual dig attempt, not approach/equip/pickup. The runtime outer limit allows the attempt plus ordinary actionMs approach allowance and2.5s pickup/cleanup margin. A time_limit result means only **not completed within this attempt budget**, NEVER unmineable with this tool. Retrying starts a new digging attempt, not accumulated partial progress. Longer/harder blocks can exceed either limit. The planner can choose a longer deliberate attempt, change tools, or defer. This bounded policy is an implementation default, not a Minecraft hardness threshold.

Without a request, the local pathfinder chooses its fastest carried harvest tool. This does not guarantee a desired Silk Touch/Fortune yield. `tool` names a carried item; `toolSlot`9..44 chooses an exact stack when same-name tools have different enchantments (if both supplied, both must match). Inventory observations expose actual item enchants and durability. The result records the held tool and its enchantments at the start of digging, or null for empty hand. Damage during mining aborts it; runtime connection/threat/goal/hunger handling and explicit cancellation remain active. Cancelled operations preserve already-observed block destruction and inventory gains.

## Separate observations

ActionRecord.mining contains the structured MiningResult, also encoded as the execution result and persisted in experience episodes:

- `blockBroken`: air observed after the requested dig attempt; success is not inferred from a resolved call alone.
- `tool`: actual held item, enchantments and durability at attempt start.
- `attemptMs` and `elapsedMs`: dig-attempt time and total action time.
- `drops`: newly observed item entities within4 blocks of the target, visible through the normal geometric vision check; includes observed item/count when decodable.
- `dropObservation`: observed_near_target / none_observed / not_checked. **none_observed does not prove no server drop occurred**.
- `inventoryGained`: positive per-item inventory deltas across the action. Counts actual inventory increases, not expected loot.
- `pickup`: inventory_gain_observed / no_inventory_gain / not_attempted / interrupted.
- `status`: finished / failed / cancelled / time_limit and a bounded detail string.

Visible nearby drops and inventory changes are NOT proof of causal origin: another entity can drop/pick up items, stacks can merge, and items can be collected before visually observed. Existing item IDs are excluded from the nearby-new-drop list, but inventory deltas may include unrelated pickups. The explicit attribution field preserves this limitation. There are no enemy/private-inventory/admin inputs or invented loot expectations.

After a confirmed break, observe briefly and try one visible nearby drop for at most2 seconds, using the existing observed-terrain pathfinder. Visible enemies, own damage, cancellation or blocked routes stop pickup. Pickup failure does not erase block-breaking evidence. Mine action_success means the block broke; a resource objective must use inventory_at_least (or inspect the measured inventory delta), not action_success. The model is explicitly told not to infer missing Silk Touch, wrong equipment, guaranteed no loot, or impossibility from one missing observation or timeout.

## Compatibility and validation

Stored episodes retain their original gather/dig_block action names and results; no fabricated coordinates or new mining evidence are backfilled. Old guideline scopes are accepted on read and projected to mine with a legacyAction label for retrieval without modifying the source file. Newly generated guidelines must use current action names. Historical social statements/commitments remain historical; old actions are not reintroduced as execution aliases. Existing source tests and functional probe requests were updated to explicit mine targets. The old approved social run markers are not reset.

Typecheck and108 offline tests passed (runs/mine-tests.log). Tests cover destruction without observed loot, visible uncollected drops, actual inventory gains, exact enchanted tool selection, time_limit semantics and elapsed time, damage cancellation, obsolete timer cleanup, journal persistence, resource completion, historical guideline compatibility and parser/runtime integration. No live server connection, paid API call, or main experiment was run. Real drop observation, timing and pickup reliability still need bounded live validation.

## Live functional validation — 2026-10-17
Supersedes the earlier offline-only status above. Final bounded server round separately logged plank destruction, visible item drop and inventory gain1; glass destruction with no observed drop and no gain; a bread-on-stone1001ms incomplete attempt; and iron-pickaxe stone destruction with visible cobblestone and inventory gain1. Server independently confirms block transitions and inventory counts. Missing observations remain uncertain, not proof of no drop. No Silk Touch positive case or120s attempt was tested.
Pickup now looks at the item and observes newly exposed ground before navigation, targets the exact drop cell, stops movement on cleanup and waits200ms for inventory reconciliation. This fixed short stopping and late pickup attribution found in the first two live rounds; earlier logs are preserved. Final evidence: runs/build-mine-1792223107352/events.jsonl; server runs/build-mine-admin3.txt. Typecheck +110 tests passed. No API calls or main experiment.

Standalone `pickup` now shares the local drop-approach helper with mine. Mine still automatically attempts one nearby drop for2s; existing or leftover drops can be selected independently. See PICKUP.md. Existing mining regressions pass with this refactor; no additional live mine run was performed for the extraction.
