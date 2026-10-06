@AGENTS.md

## Tests

Run every test locally, as often as useful, always through `scripts/quiet.sh`: it keeps the whole output in a log file and prints only the failures, the summary and the log's path (about 30 lines whatever the run prints), so a long run costs little context. Time is cheap, tokens are not. Grep the log for details instead of rerunning.

- Unit tests, typecheck and lint: `scripts/quiet.sh npm test`, `scripts/quiet.sh npm run typecheck`, `scripts/quiet.sh npm run lint`.
- Client packages: `scripts/quiet.sh sh -c 'cd packages/js && npm ci && npm run build && npm test'` and `scripts/quiet.sh sh -c 'cd packages/python && uv run --locked --extra test pytest -q'`.
- e2e: `scripts/quiet.sh npm run test:e2e`.
- A single test run to debug one failure may go directly (`npx vitest run <path> -t <name>`, `npx playwright test -g <name>`); every broad run goes through `scripts/quiet.sh`.
- Docker builds are left to CI.

CI is still the gate, and I decide when a branch is finished and when it is merged. When a branch seems finished, ask me before doing anything with it: do not push it, open the PR or merge on your own. These rules override any skill (executing-plans, finishing-a-development-branch, ship-pr) that says to merge or finish on its own; a `/ccp:ship-pr` request is the go-ahead for push and PR only, not for the merge. When I say to, push it, open the PR and wait for CI (`gh pr checks <number> --watch`), then tell me the result and stop: I review the PR. Merge only when I say "merge". When I do, look at the CI status of the branch's latest commit: if it ran green, merge; do not run it again. Run CI and wait only if it has not run on the latest state; and if it is red, tell me which jobs and wait for my answer instead of merging. If something fails, read the failed job's log first (`gh run view <run> --log-failed`) and reproduce locally only when that is not enough.

## Releases

A `vX.Y.Z` tag is a release: see the `release` skill (`.claude/skills/release/SKILL.md`) before bumping versions or tagging.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues (`notefeed/notefeed`) with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the repo root and ADRs in `docs/adr/`. See `docs/agents/domain.md`.
