@AGENTS.md

## Tests

Run every test locally, as often as useful, always through `scripts/quiet.sh`: it keeps the whole output in a log file and prints only the failures, the summary and the log's path (about 30 lines whatever the run prints), so a long run costs little context. Time is cheap, tokens are not. Grep the log for details instead of rerunning.

- Unit tests, typecheck and lint: `scripts/quiet.sh npm test`, `scripts/quiet.sh npm run typecheck`, `scripts/quiet.sh npm run lint`.
- Client packages: `scripts/quiet.sh sh -c 'cd packages/js && npm ci && npm run build && npm test'` and `scripts/quiet.sh sh -c 'cd packages/python && uv run --locked --extra test pytest -q'`.
- e2e: `scripts/quiet.sh npm run test:e2e`.
- Docker builds are left to CI.

CI is still the gate. When a branch is finished, push it, open the PR and wait for CI (`gh pr checks <number> --watch`); if everything is green, merge. If something fails, read the failed job's log first (`gh run view <run> --log-failed`) and reproduce locally only when that is not enough.

## Releases

A `vX.Y.Z` tag is a release (same tag scheme as the MCP repos): `ci.yml` pushes the image as `:X.Y.Z`/`:X.Y`/`:X`/`:latest` and creates the GitHub release (notes = the annotated tag message, so tag with `git tag -a`, followed by the generated list of pull requests merged since the previous release), and `clients.yml` publishes the client packages to PyPI and npm. Before tagging, bump `version` to `X.Y.Z` in both `packages/python/pyproject.toml` and `packages/js/package.json`, and commit that on `main`. The release job refuses a tag that doesn't match both. npm and PyPI refuse a version that is already published, so every release needs a new version.
