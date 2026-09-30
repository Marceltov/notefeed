import pytest

from notefeed import AuthError, Client, ConfigError, InvalidNoteError, Note, NotefeedError, NoteTooLargeError, post


def test_post_sends_markdown_and_returns_note(server):
    server.reply(201, {"id": "20260930T100000Z-cafe", "url": "https://n.example/n/20260930T100000Z-cafe"})
    note = Client(server.url, "t").post("# Café\r\nx")
    assert note == Note("20260930T100000Z-cafe", "https://n.example/n/20260930T100000Z-cafe")
    req = server.requests[0]
    assert req["path"] == "/api/notes"
    assert req["headers"]["Authorization"] == "Bearer t"
    assert req["headers"]["Content-Type"] == "text/markdown; charset=utf-8"
    assert req["body"] == "# Café\r\nx".encode()


def test_trailing_slash_and_subpath(server):
    Client(server.url + "/sub/", "t").post("x")
    assert server.requests[0]["path"] == "/sub/api/notes"


def test_env_config(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", server.url)
    monkeypatch.setenv("NOTEFEED_TOKEN", "envtok")
    Client().post("x")
    assert server.requests[0]["headers"]["Authorization"] == "Bearer envtok"


def test_explicit_args_win(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("NOTEFEED_TOKEN", "envtok")
    Client(server.url, "argtok").post("x")
    assert server.requests[0]["headers"]["Authorization"] == "Bearer argtok"


def test_missing_config_names_variable(monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", "http://x")
    monkeypatch.setenv("NOTEFEED_TOKEN", "")  # empty counts as unset
    with pytest.raises(ConfigError, match="NOTEFEED_TOKEN") as e:
        Client()
    assert e.value.status is None
    monkeypatch.delenv("NOTEFEED_URL")
    with pytest.raises(ConfigError, match="NOTEFEED_URL"):
        Client(token="t", url="")  # empty argument and no env var


@pytest.mark.parametrize(
    ("status", "error"),
    [(400, InvalidNoteError), (415, InvalidNoteError), (401, AuthError), (413, NoteTooLargeError), (500, NotefeedError)],
)
def test_error_mapping(server, status, error):
    server.reply(status, {"error": f"reason {status}"})
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "t").post("x")
    assert type(e.value) is error
    assert e.value.status == status
    assert str(e.value) == f"reason {status}"


def test_non_json_error_body(server):
    server.reply(502, "<html>bad gateway</html>", "text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "t").post("x")
    assert type(e.value) is NotefeedError
    assert e.value.status == 502
    assert "502" in str(e.value)


def test_connection_refused():
    with pytest.raises(NotefeedError) as e:
        Client("http://127.0.0.1:1", "t").post("x")
    assert e.value.status is None


def test_module_level_post(server):
    assert post("x", url=server.url, token="t") == Note("i", "u")


def test_non_json_success_body(server):
    server.reply(200, "<html>some other site</html>", "text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "t").post("x")
    assert type(e.value) is NotefeedError
    assert e.value.status == 200
    assert "not a notefeed" in str(e.value)
