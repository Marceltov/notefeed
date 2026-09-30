import json
from pathlib import Path

import pytest

import notefeed


def test_version_matches_pyproject():
    toml = (Path(__file__).parents[1] / "pyproject.toml").read_text()
    assert f'\nversion = "{notefeed.__version__}"\n' in toml


def test_matches_js_package():
    pkg = Path(__file__).parents[2] / "js" / "package.json"
    if not pkg.exists():
        pytest.skip("JS package not present")
    assert json.loads(pkg.read_text())["version"] == notefeed.__version__
