@AGENTS.md

## Releases

A `vX.Y.Z` tag is a release: `.github/workflows/clients.yml` publishes the client packages to PyPI and npm (same tag scheme as the MCP repos). Before tagging, bump `version` to `X.Y.Z` in both `packages/python/pyproject.toml` and `packages/js/package.json`, and commit that on `main`. The release job refuses a tag that doesn't match both, and a version already on npm can't be published again.
