@AGENTS.md

## Tests

Unit tests (vitest) are fine to run locally, along with typecheck and lint. Don't run the client packages' tests or e2e locally: CI is fast, so push and let it run them.

## Releases

A `vX.Y.Z` tag is a release (same tag scheme as the MCP repos): `ci.yml` pushes the image as `:X.Y.Z`/`:X.Y`/`:X`/`:latest` and creates the GitHub release (notes = the annotated tag message, so tag with `git tag -a`, followed by the generated list of pull requests merged since the previous release), and `clients.yml` publishes the client packages to PyPI and npm. Before tagging, bump `version` to `X.Y.Z` in both `packages/python/pyproject.toml` and `packages/js/package.json`, and commit that on `main`. The release job refuses a tag that doesn't match both. npm and PyPI refuse a version that is already published, so every release needs a new version.
