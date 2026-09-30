import pytest

from notefeed import (
    AuthError,
    Client,
    ConfigError,
    InvalidNoteError,
    LimitReachedError,
    Note,
    NotefeedError,
    NoteTooLargeError,
    RateLimitedError,
)

CREATED = {
    "id": "20260930T100000Z-cafe",
    "url": "https://n.example/inbox/20260930T100000Z-cafe",
    "feed_url": "https://n.example/inbox",
    "read_url": "https://n.example/r/AAAAAAAAAAAAAAAAAAAAAA/feed.xml",
}


def test_post_sends_markdown_and_returns_note(server):
    server.reply(201, CREATED)
    note = Client(server.url, "inbox").post("# Café\r\nx")
    assert note == Note(CREATED["id"], CREATED["url"], CREATED["read_url"])
    req = server.requests[0]
    assert req["path"] == "/inbox"
    assert "Authorization" not in req["headers"]
    assert req["headers"]["Content-Type"] == "text/markdown; charset=utf-8"
    assert req["body"] == "# Café\r\nx".encode()


def test_returns_read_url(server):
    server.reply(201, CREATED)
    assert Client(server.url, "inbox").post("x").read_url == CREATED["read_url"]


def test_trailing_slash_and_subpath(server):
    Client(server.url + "/sub/", "inbox").post("x")
    assert server.requests[0]["path"] == "/sub/inbox"


def test_post_uses_client_feed(server):
    Client(server.url, feed="inbox").post("x")
    assert server.requests[0]["path"] == "/inbox"


def test_post_feed_overrides_client_feed(server):
    Client(server.url, feed="inbox").post("x", feed="other")
    Client(server.url).post("x", feed="other")
    assert [r["path"] for r in server.requests] == ["/other", "/other"]


def test_no_feed_raises_config_error_before_request(server):
    with pytest.raises(ConfigError, match="no feed given") as e:
        Client(server.url).post("x")
    assert e.value.status is None
    assert len(server.requests) == 0


@pytest.mark.parametrize("feed", ["Inbox", "a/b", "..", "a" * 65, "with space"])
def test_invalid_feed_name_raises_config_error(server, feed):
    with pytest.raises(ConfigError, match="invalid feed name"):
        Client(server.url, feed=feed)
    with pytest.raises(ConfigError, match="invalid feed name"):
        Client(server.url).post("x", feed=feed)
    assert len(server.requests) == 0


def test_invalid_feed_name_is_not_echoed(server):
    # The name is the write key: a near miss must not end up in CI logs.
    feed = "Homelab-7f3k2q9x4m8wz"
    for call in (lambda: Client(server.url, feed=feed), lambda: Client(server.url).post("x", feed=feed)):
        with pytest.raises(ConfigError, match="invalid feed name") as e:
            call()
        assert "7f3k2q9x4m8wz" not in str(e.value)


def test_password_sent_as_bearer_only_when_set(server):
    Client(server.url, "inbox").post("x")
    Client(server.url, "inbox", password="").post("x")
    Client(server.url, "inbox", password="s3cret\n").post("x")
    assert [r["headers"].get("Authorization") for r in server.requests] == [None, None, "Bearer s3cret"]


def test_ignores_environment(server, monkeypatch):
    # The library takes its settings from code only; env vars are the CLI's business.
    monkeypatch.setenv("NOTEFEED_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("NOTEFEED_FEED", "envfeed")
    monkeypatch.setenv("NOTEFEED_PASSWORD", "envpw")
    Client(server.url, "argfeed").post("x")
    assert server.requests[0]["path"] == "/argfeed"
    assert "Authorization" not in server.requests[0]["headers"]
    with pytest.raises(ConfigError):
        Client("")


def test_missing_url():
    with pytest.raises(ConfigError, match="url") as e:
        Client("", "inbox")
    assert e.value.status is None
    with pytest.raises(TypeError):
        Client()  # url is a required argument


def test_no_module_level_post():
    import notefeed

    assert not hasattr(notefeed, "post")


@pytest.mark.parametrize(
    ("status", "error"),
    [
        (400, InvalidNoteError),
        (415, InvalidNoteError),
        (401, AuthError),
        (413, NoteTooLargeError),
        (429, RateLimitedError),
        (507, LimitReachedError),
        (500, NotefeedError),
    ],
)
def test_error_mapping(server, status, error):
    server.reply(status, {"error": f"reason {status}"})
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert type(e.value) is error
    assert e.value.status == status
    assert str(e.value) == f"reason {status}"


def test_429_raises_rate_limited_with_retry_after(server):
    server.reply(429, {"error": "rate limit exceeded"}, headers={"Retry-After": "42"})
    server.reply(429, {"error": "rate limit exceeded"})
    c = Client(server.url, "inbox")
    with pytest.raises(RateLimitedError) as e:
        c.post("x")
    assert e.value.retry_after == 42
    with pytest.raises(RateLimitedError) as e:
        c.post("x")
    assert e.value.retry_after is None


def test_507_raises_limit_reached(server):
    server.reply(507, {"error": "note limit reached"})
    with pytest.raises(LimitReachedError, match="note limit reached") as e:
        Client(server.url, "inbox").post("x")
    assert e.value.status == 507


def test_non_json_error_body(server):
    server.reply(502, "<html>bad gateway</html>", "text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert type(e.value) is NotefeedError
    assert e.value.status == 502
    assert "502" in str(e.value)


def test_connection_refused():
    with pytest.raises(NotefeedError) as e:
        Client("http://127.0.0.1:1", "inbox").post("x")
    assert e.value.status is None


def test_non_json_success_body(server):
    server.reply(200, "<html>some other site</html>", "text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert type(e.value) is NotefeedError
    assert e.value.status == 200
    assert "not a notefeed" in str(e.value)


def test_password_control_chars_rejected_without_echo():
    with pytest.raises(ConfigError) as e:
        Client("http://x", "inbox", password="sec\nret")
    assert "invalid characters" in str(e.value)
    assert "sec" not in str(e.value) and "ret" not in str(e.value)


def test_non_http_reply():
    import socket
    import threading

    srv = socket.create_server(("127.0.0.1", 0))

    def banner():
        conn, _ = srv.accept()
        conn.recv(65536)
        conn.sendall(b"SSH-2.0-OpenSSH_9.6\r\n")
        conn.close()

    threading.Thread(target=banner, daemon=True).start()
    with pytest.raises(NotefeedError) as e:
        Client(f"http://127.0.0.1:{srv.getsockname()[1]}", "inbox").post("x")
    assert e.value.status is None
    srv.close()


def test_html_error_body_collapsed(server):
    server.reply(502, "<html>\n  <body>bad gateway</body>\n</html>\n", "text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert str(e.value) == "HTTP 502: <html> <body>bad gateway</body> </html>"


def test_retry_after_accepts_ascii_digits_only(server):
    # "²" is latin-1, so it survives an HTTP header; str.isdigit() accepts it but int() does not.
    server.reply(429, {"error": "rate limit exceeded"}, headers={"Retry-After": "\u00b2"})
    with pytest.raises(RateLimitedError) as e:
        Client(server.url, "inbox").post("x")
    assert e.value.retry_after is None
