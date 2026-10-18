# Repository instructions

- Active implementation: `v2/`. Read README.md, v2/README.md, v2/docs/ARCHITECTURE.md and v2/docs/VALIDATION.md.
- Inspect Git changes and active processes before work. Preserve others' changes and running sessions.
- Honor the requested test scope and budget. Documentation changes do not authorize API calls or live runs.
- Keep one action owner per bot, revalidate observations, and reject stale responses. Preserve cancellation.
- Recipes come from server unlocks. Do not expose hidden map, opponent HP or another player's inventory to models.
- Reuse existing actions where practical. Do not substitute local strategic decisions for model choices.
- Distinguish implementation, mock tests, controlled live checks and demonstrated autonomous performance.
- Public docs describe current behavior, setup, relevant comparisons and verified limitations. Keep them concise; replace stale status rather than appending each run or duplicating TODO lists.
- Keep detailed development history, handoffs, raw evidence and personal planning in ignored `v2/runs/private-docs/`. Consult local records when present; retain failure evidence there. Do not publish them by default.
- Run checks relevant to the change; for documentation, verify local links and consistency with current code.
- Every push must follow SECURITY.md and inspect both tracked files and outgoing history. Never force-add credentials, server information, runs, logs or memories.
