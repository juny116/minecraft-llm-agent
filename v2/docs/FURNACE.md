# Furnace via existing container actions
inspect_container replaces inspect_chest. Chest behavior is preserved; visible furnace, blast_furnace and smoker use the same inspection and transfer interface. Normal furnace live-tested; other furnace variants not independently live-tested.

Specify container:{x,y,z}. deposit requires transfer:{item,count,slot:"input"|"fuel"}; withdraw requires slot:"input"|"fuel"|"output". Output deposits are rejected. Amount1..64; exact requested amount required. Inspection exposes only actual opened slots and received progress/fuel properties (nullable), timestamped. No extra recipe catalog or hidden completion timer is supplied to models.

Processing continues server-side after window close. Agent observes, does another action or waits, reinspects, then withdraws actual output. A deposit success is inventory transfer only; processingComplete:false prevents treating it as smelting completion. Fuel may be consumed immediately. Window closes before own inventory delta verification. Visibility, reach, cancellation and source slot checks apply.

place_block supports furnace variants; mine uses the same block/drop/pickup evidence as other blocks. Live normal-furnace chain placed a furnace, loaded raw iron1/coal1, observed/withdrew iron_ingot1, then mined/recovered furnace1. It was deterministic no-API validation, not autonomous furnace discovery. Progress-property settling remains separately unverified live.
