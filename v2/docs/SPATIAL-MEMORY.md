# Private spatial recollection
spatial.json persists beside each bot's experience/social memory, isolated by namespace/server/version/bot and dimension. Only observed blocks and opened container contents are saved; original timestamps remain intact. Bounds:8 dimensions,1024 place summaries and16 containers per dimension. Atomic writes are throttled5s and flushed on close/dimension changes. Malformed or mismatched files fail without overwriting evidence.

Remembered is not currently visible or guaranteed unchanged. A container must still be currently visible/reachable before interaction, and opening refreshes its contents. Observing removal or confirming mine invalidates its cached contents. Old files can retain stale observations until revisited. Neither another bot's inventory nor the server's full map is shared.

Persistent places support model recollection, not omniscient navigation: current pathfinder support still requires current-session visible terrain. Distant routes may need renewed exploration. Live separate-process reconnect recovered an old chest observation and refreshed it on opening. This does not validate arbitrary long-range routes.
