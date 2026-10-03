@AGENTS.md

## Tests

Unit tests (vitest) are fine to run locally, along with typecheck and lint. Don't run the client packages' tests locally: CI is fast, so push and let it run them. Don't run e2e while developing either.

When a branch is finished, push it, open the PR and wait for CI. Check the result (`gh pr checks <number>`); if everything is green, merge. Run tests locally (client packages, e2e) only when CI fails, to reproduce and debug, not before.

Run test commands through `scripts/quiet.sh`, e.g. `scripts/quiet.sh npx vitest run` or `scripts/quiet.sh npx playwright test`: it keeps the whole output in a log file and prints only the failures, the summary and the log's path, so a long run doesn't fill your context. Grep the log for details instead of rerunning.

## Releases

A `vX.Y.Z` tag is a release (same tag scheme as the MCP repos): `ci.yml` pushes the image as `:X.Y.Z`/`:X.Y`/`:X`/`:latest` and creates the GitHub release (notes = the annotated tag message, so tag with `git tag -a`, followed by the generated list of pull requests merged since the previous release), and `clients.yml` publishes the client packages to PyPI and npm. Before tagging, bump `version` to `X.Y.Z` in both `packages/python/pyproject.toml` and `packages/js/package.json`, and commit that on `main`. The release job refuses a tag that doesn't match both. npm and PyPI refuse a version that is already published, so every release needs a new version.
