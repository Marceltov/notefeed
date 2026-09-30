import json
from pathlib import Path

import pytest

import notefeed


def test_version():
    assert notefeed.__version__ == "0.1.0"


def test_matches_js_package():
    pkg = Path(__file__).parents[2] / "js" / "package.json"
    if not pkg.exists():
        pytest.skip("JS package not present")
    assert json.loads(pkg.read_text())["version"] == notefeed.__version__
