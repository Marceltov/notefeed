import json
from urllib.parse import parse_qs, urlparse

import pytest

from notefeed import (
    AuthError,
    Client,
    ConfigError,
    Created,
    InvalidRequestError,
    LimitReachedError,
    NotefeedError,
    NotFoundError,
    NoteTooLargeError,
    RateLimitedError,
)

CREATED = {
    "id": "20260930T100000Z-cafe",
    "url": "https://n.example/inbox/20260930T100000Z-cafe",
    "feed_url": "https://n.example/inbox",
    "read_url": "https://n.example/r/AAAAAAAAAAAAAAAAAAAAAA/feed.xml",
}
READ_ID = "A" * 22


def note(h):
    return {
        "id": f"20260930T{h:02d}0000Z-n{h}",
        "title": f"N{h}",
        "markdown": f"# N{h}",
        "created_at": f"2026-09-30T{h:02d}:00:00.000Z",
        "url": f"https://n.example/inbox/n{h}",
    }


def serve_feed(server, notes):
    """Answer list requests from `notes`, paged by `before`, newest first, like the server."""

    def route(method, path):
        q = parse_qs(urlparse(path).query)
        limit = int(q.get("limit", ["50"])[0])
        before = q.get("before", [None])[0]
        older = [n for n in sorted(notes, key=lambda n: n["id"], reverse=True) if not before or n["id"] < before]
        page = older[:limit]
        return 200, {"notes": page, "next": page[-1]["id"] if len(older) > limit else None}

    server.route = route


# --- post ---


def test_post_sends_markdown_as_json_and_returns_created(server):
    server.reply(201, CREATED)
    created = Client(server.url, "inbox").post("# Café\r\nx")
    assert isinstance(created, Created)
    assert (created.id, created.url, created.read_url) == (CREATED["id"], CREATED["url"], CREATED["read_url"])
    req = server.requests[0]
    assert (req["method"], req["path"]) == ("POST", "/api/v1/feeds/inbox/notes")
    assert json.loads(req["body"]) == {"markdown": "# Café\r\nx"}
    assert "Authorization" not in req["headers"]


def test_password_is_a_bearer_and_a_per_call_feed_wins(server):
    Client(server.url, "inbox", password="pw").post("x", feed="other")
    assert server.requests[0]["path"] == "/api/v1/feeds/other/notes"
    assert server.requests[0]["headers"]["Authorization"] == "Bearer pw"


def test_a_base_url_with_a_prefix_and_trailing_slash_keeps_the_prefix(server):
    Client(f"{server.url}/prefix/", "inbox").post("x")
    assert server.requests[0]["path"] == "/prefix/api/v1/feeds/inbox/notes"


# --- errors ---


@pytest.mark.parametrize(
    "code,status,cls",
    [
        ("auth", 401, AuthError),
        ("rate_limited", 429, RateLimitedError),
        ("too_many_attempts", 429, RateLimitedError),
        ("not_found", 404, NotFoundError),
        ("feed_limit", 507, LimitReachedError),
        ("note_limit", 507, LimitReachedError),
        ("too_large", 413, NoteTooLargeError),
        ("invalid_feed", 400, InvalidRequestError),
        ("reserved_feed", 400, InvalidRequestError),
        ("empty_note", 400, InvalidRequestError),
        ("invalid_body", 400, InvalidRequestError),
        ("invalid_request", 400, InvalidRequestError),
        ("unsupported_type", 415, InvalidRequestError),
    ],
)
def test_errors_map_from_the_code(server, code, status, cls):
    server.reply(status, {"error": f"because {code}", "code": code})
    with pytest.raises(cls) as e:
        Client(server.url, "inbox").post("x")
    assert (e.value.status, e.value.code, str(e.value)) == (status, code, f"because {code}")


def test_rate_limited_carries_retry_after(server):
    server.reply(429, {"error": "slow down", "code": "rate_limited"}, headers={"Retry-After": "17"})
    with pytest.raises(RateLimitedError) as e:
        Client(server.url, "inbox").post("x")
    assert e.value.retry_after == 17


@pytest.mark.parametrize("status", [502, 429])
def test_an_html_error_page_from_a_proxy_is_a_notefeed_error(server, status):
    server.reply(status, "<html><body>Bad Gateway</body></html>", ctype="text/html")
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert (e.value.status, e.value.code) == (status, None)
    assert str(e.value).startswith(f"HTTP {status}")


def test_an_unreachable_server_is_a_notefeed_error_without_status(server):
    url = server.url
    server.httpd.shutdown()
    server.httpd.server_close()
    with pytest.raises(NotefeedError) as e:
        Client(url, "inbox", timeout=2).post("x")
    assert e.value.status is None
    assert str(e.value).startswith("could not reach")


# --- config ---


@pytest.mark.parametrize("feed", ["Bad Name", "a/b"])
def test_an_invalid_feed_is_a_config_error_and_nothing_is_sent(server, feed):
    with pytest.raises(ConfigError):
        Client(server.url).post("x", feed=feed)
    assert server.requests == []


def test_no_feed_and_no_url_are_config_errors(server):
    with pytest.raises(ConfigError):
        Client(server.url).post("x")
    with pytest.raises(ConfigError):
        Client("")


def test_a_control_character_inside_the_password_is_a_config_error(server):
    with pytest.raises(ConfigError):
        Client(server.url, password="p\nw")
    Client(server.url, password="pw\n")  # surrounding whitespace is trimmed


def test_from_env(server):
    c = Client.from_env({"NOTEFEED_URL": server.url, "NOTEFEED_FEED": "inbox", "NOTEFEED_PASSWORD": "pw"})
    c.post("x")
    assert server.requests[0]["path"] == "/api/v1/feeds/inbox/notes"
    assert server.requests[0]["headers"]["Authorization"] == "Bearer pw"


# --- reading ---


def test_notes_walks_every_page_newest_first(server):
    serve_feed(server, [note(h) for h in range(10, 15)])
    got = list(Client(server.url, "inbox").notes(page_size=2))
    assert [n.title for n in got] == ["N14", "N13", "N12", "N11", "N10"]
    befores = [parse_qs(urlparse(r["path"]).query).get("before", [None])[0] for r in server.requests]
    assert befores == [None, note(13)["id"], note(11)["id"]]
    assert {urlparse(r["path"]).path for r in server.requests} == {"/api/v1/feeds/inbox/notes"}


def test_a_note_posted_while_paging_is_neither_repeated_nor_yielded(server):
    notes = [note(h) for h in range(10, 14)]
    serve_feed(server, notes)
    seen = []
    for n in Client(server.url, "inbox").notes(page_size=2):
        seen.append(n.title)
        if len(seen) == 1:
            notes.append(note(20))
    assert seen == ["N13", "N12", "N11", "N10"]


def test_note_and_read_note(server):
    server.route = lambda method, path: (200, note(10))
    c = Client(server.url, "inbox")
    assert c.note(note(10)["id"]).title == "N10"
    assert c.read_note(READ_ID, note(10)["id"]).title == "N10"
    assert [r["path"] for r in server.requests] == [
        f"/api/v1/feeds/inbox/notes/{note(10)['id']}",
        f"/api/v1/read/{READ_ID}/notes/{note(10)['id']}",
    ]


def test_read_notes_needs_no_feed(server):
    server.route = lambda method, path: (200, {"notes": [note(10)], "next": None})
    assert [n.title for n in Client(server.url).read_notes(READ_ID)] == ["N10"]
    assert urlparse(server.requests[0]["path"]).path == f"/api/v1/read/{READ_ID}/notes"
