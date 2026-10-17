# Repository instructions
- Active implementation: v2/. Read README.md, v2/docs/SPEC.md and HANDOFF.md first.
- Inspect branch, changes and active processes; preserve others' work and coordinate ownership.
- Functional checks only unless explicitly authorized otherwise. Honor the user's current budget; no implicit paid/background runs.
- One action owner per bot; revalidate visibility/state and reject stale responses. Preserve cancellation.
- Recipes come from server unlocks. No hidden map, opponent HP or another inventory in model inputs.
- Verify actual outcomes; distinguish mock, live functional evidence and experiments.
- Update README actions/status/TODO with each feature change. Prefer reusing actions.
- EVERY push: follow SECURITY.md; inspect tracked files AND outgoing history for secrets/server information. Never force-add .env, runs, logs, memories, credentials or SSH files.
- Private operational handoffs belong in ignored runs/private-docs/. Public docs use placeholders.
- Run relevant typecheck/tests from v2/. Do not publish user server addresses, accounts, SSH aliases or deployment paths.

## Engineering history (required ongoing workflow)
- Read v2/docs/ENGINEERING_LOG.md before substantive changes; use its stable MC IDs.
- For each meaningful issue, failed attempt, design change or live finding, record the symptom, confirmed cause versus hypothesis, intervention, validation level, remaining limits and evidence. Append dated follow-ups to existing IDs; do not erase contrary evidence or call an unrun proposal fixed.
- Keep README TODO/status and v2/docs/PORTFOLIO.md consistent with verified outcomes. Historical test counts must retain their time scope; no benchmark or human-like capability claims from a single fixture.
- Save raw run/commit/admin evidence mappings privately under ignored runs/private-docs/. Public entries use sanitized code/tests/docs/commit links only. Apply SECURITY.md to the entire outgoing history.
- Documentation updates alone do not authorize new paid calls or live experiments.
