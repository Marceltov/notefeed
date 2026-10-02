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


def test_post_to_a_feed_without_a_read_link_has_read_url_none(server):
    server.reply(201, {**CREATED, "read_url": None})
    assert Client(server.url, "inbox").post("# Hi").read_url is None


def test_password_is_a_bearer_and_a_per_call_feed_wins(server):
    Client(server.url, "inbox", password="pw").post("x", feed="other")
    assert server.requests[0]["path"] == "/api/v1/feeds/other/notes"
    assert server.requests[0]["headers"]["Authorization"] == "Bearer pw"


def test_feed_password_goes_as_x_feed_password_and_a_per_call_one_wins(server):
    server.route = lambda method, path: (200, {"notes": [], "next": None}) if method == "GET" and "/notes/" not in path else (200, note(10)) if method == "GET" else (201, CREATED)
    c = Client(server.url, "inbox", feed_password="fp")
    c.post("x")
    list(c.notes())
    c.note("20260930T100000Z-n10")
    c.post("x", feed_password="other")
    Client(server.url, "inbox").post("x")
    got = [r["headers"].get("X-Feed-Password") for r in server.requests]
    assert got == ["fp", "fp", "fp", "other", None]
    assert "Authorization" not in server.requests[0]["headers"]


def test_a_control_character_in_the_feed_password_is_a_config_error(server):
    with pytest.raises(ConfigError):
        Client(server.url, feed_password="p\nw")


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
        ("image_limit", 507, LimitReachedError),
        ("too_large", 413, NoteTooLargeError),
        ("invalid_feed", 400, InvalidRequestError),
        ("reserved_feed", 400, InvalidRequestError),
        ("empty_note", 400, InvalidRequestError),
        ("invalid_body", 400, InvalidRequestError),
        ("invalid_request", 400, InvalidRequestError),
        ("unsupported_type", 415, InvalidRequestError),
        ("feed_exists", 409, InvalidRequestError),
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


# --- answers that aren't the API's ---


def test_a_redirect_says_which_address_to_use(server):
    server.reply(301, "", headers={"Location": "https://notes.example.com/api/v1/feeds/inbox/notes"})
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert "redirected to https://notes.example.com" in str(e.value)


@pytest.mark.parametrize(
    "body",
    [
        {"foo": 1},  # missing fields
        ["not", "an", "object"],
    ],
)
def test_a_2xx_that_isnt_a_created_note_is_a_notefeed_error(server, body):
    server.reply(201, body)
    with pytest.raises(NotefeedError, match="unexpected response"):
        Client(server.url, "inbox").post("x")


def test_a_note_with_a_bad_date_is_a_notefeed_error(server):
    server.route = lambda method, path: (200, {"notes": [{**note(10), "created_at": "garbage"}], "next": None})
    with pytest.raises(NotefeedError, match="unexpected response"):
        list(Client(server.url, "inbox").notes())


def test_a_code_that_isnt_a_string_is_ignored(server):
    server.reply(400, {"error": "odd", "code": ["x"]})
    with pytest.raises(NotefeedError) as e:
        Client(server.url, "inbox").post("x")
    assert type(e.value) is NotefeedError and e.value.code is None


def test_a_malformed_url_is_a_config_error():
    with pytest.raises(ConfigError):
        Client("http://[::1", "inbox")


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
    c = Client.from_env({"NOTEFEED_URL": server.url, "NOTEFEED_FEED": "inbox", "NOTEFEED_PASSWORD": "pw", "NOTEFEED_FEED_PASSWORD": "fp"})
    c.post("x")
    assert server.requests[0]["headers"]["X-Feed-Password"] == "fp"
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


# --- lifetime ---


def test_close_and_with_release_the_connection_pool(server):
    with Client(server.url, "inbox") as c:
        c.post("x")
        pool = c._api.get_httpx_client()
    assert pool.is_closed
    c2 = Client(server.url, "inbox")
    c2.post("x")
    c2.close()
    assert c2._api.get_httpx_client().is_closed


# --- edit and delete ---

NOTE_ID = "20260930T100000Z-n10"


def test_edit_puts_markdown_and_returns_the_note(server):
    server.reply(200, note(10))
    with Client(server.url, "inbox", "pw", feed_password="fp") as c:
        edited = c.edit(NOTE_ID, "# New\r\nx")
        assert edited.id == note(10)["id"]
        req = server.requests[0]
        assert (req["method"], req["path"]) == ("PUT", f"/api/v1/feeds/inbox/notes/{NOTE_ID}")
        assert json.loads(req["body"]) == {"markdown": "# New\r\nx"}
        assert req["headers"]["Authorization"] == "Bearer pw"
        assert req["headers"]["X-Feed-Password"] == "fp"
        server.reply(200, note(10))
        c.edit(NOTE_ID, "x", feed="other", feed_password="o")
        assert server.requests[1]["path"] == f"/api/v1/feeds/other/notes/{NOTE_ID}"
        assert server.requests[1]["headers"]["X-Feed-Password"] == "o"


def test_delete_sends_delete_and_returns_none(server):
    server.reply(204, "")
    with Client(server.url, "inbox", feed_password="fp") as c:
        assert c.delete(NOTE_ID) is None
    req = server.requests[0]
    assert (req["method"], req["path"]) == ("DELETE", f"/api/v1/feeds/inbox/notes/{NOTE_ID}")
    assert req["headers"]["X-Feed-Password"] == "fp"
    assert req["body"] == b""


def test_edit_and_delete_404_is_not_found_and_no_feed_is_config_error(server):
    c = Client(server.url, "inbox")
    for call in (lambda: c.edit(NOTE_ID, "x"), lambda: c.delete(NOTE_ID)):
        server.reply(404, {"error": "no such note", "code": "not_found"})
        with pytest.raises(NotFoundError):
            call()
    with pytest.raises(ConfigError):
        Client(server.url).delete(NOTE_ID)


# --- feed settings and deletion ---

FEED = {"name": "inbox", "title": "My inbox", "description": "Things", "protected": False, "read_url": None, "image_url": None}


def test_feed_info_gets_the_feed(server):
    server.reply(200, FEED)
    with Client(server.url, "inbox", "pw", feed_password="fp") as c:
        info = c.feed_info()
        assert (info.name, info.title, info.description, info.protected) == ("inbox", "My inbox", "Things", False)
        req = server.requests[0]
        assert (req["method"], req["path"]) == ("GET", "/api/v1/feeds/inbox")
        assert req["headers"]["Authorization"] == "Bearer pw"
        assert req["headers"]["X-Feed-Password"] == "fp"
        server.reply(200, FEED)
        c.feed_info(feed="other", feed_password="o")
        assert server.requests[1]["path"] == "/api/v1/feeds/other"
        assert server.requests[1]["headers"]["X-Feed-Password"] == "o"


def test_update_feed_puts_title_and_description(server):
    server.reply(200, FEED)
    with Client(server.url, "inbox", feed_password="fp") as c:
        assert c.update_feed("My inbox", "Things").title == "My inbox"
        req = server.requests[0]
        assert (req["method"], req["path"]) == ("PUT", "/api/v1/feeds/inbox")
        assert json.loads(req["body"]) == {"title": "My inbox", "description": "Things"}
        assert req["headers"]["X-Feed-Password"] == "fp"
        server.reply(200, FEED)
        c.update_feed("", "", feed="other", feed_password="o")
        assert server.requests[1]["path"] == "/api/v1/feeds/other"
        assert server.requests[1]["headers"]["X-Feed-Password"] == "o"


def test_delete_feed_sends_delete_and_returns_none(server):
    server.reply(204, "")
    with Client(server.url, "inbox", feed_password="fp") as c:
        assert c.delete_feed() is None
    req = server.requests[0]
    assert (req["method"], req["path"]) == ("DELETE", "/api/v1/feeds/inbox")
    assert req["headers"]["X-Feed-Password"] == "fp"
    assert req["body"] == b""


def test_feed_calls_404_is_not_found_and_no_feed_is_config_error(server):
    c = Client(server.url, "inbox")
    for call in (lambda: c.feed_info(), lambda: c.update_feed("", ""), lambda: c.delete_feed()):
        server.reply(404, {"error": "no such feed", "code": "not_found"})
        with pytest.raises(NotFoundError):
            call()
    with pytest.raises(ConfigError):
        Client(server.url).delete_feed()


UPLOADED = {"file": "a" * 32 + ".png", "url": "https://n.example/r/X/images/a.png", "markdown": "![](https://n.example/r/X/images/a.png)"}


def test_upload_image_posts_the_raw_bytes_and_returns_the_model(server):
    server.reply(201, UPLOADED)
    data = bytes([0x89, 0x50, 0x4E, 0x47, 0, 255])
    r = Client(server.url, "inbox", "pw", feed_password="fp").upload_image(data)
    assert (r.file, r.url, r.markdown) == (UPLOADED["file"], UPLOADED["url"], UPLOADED["markdown"])
    q = server.requests[0]
    assert (q["method"], q["path"], q["body"]) == ("POST", "/api/v1/feeds/inbox/images", data)
    assert q["headers"]["Content-Type"] == "application/octet-stream"
    assert (q["headers"]["Authorization"], q["headers"]["X-Feed-Password"]) == ("Bearer pw", "fp")


def test_upload_image_per_call_feed_and_password_win_and_errors_map(server):
    server.reply(201, UPLOADED)
    Client(server.url, "inbox", feed_password="fp").upload_image(b"x", feed="other", feed_password="o")
    assert server.requests[0]["path"] == "/api/v1/feeds/other/images"
    assert server.requests[0]["headers"]["X-Feed-Password"] == "o"
    with pytest.raises(ConfigError):
        Client(server.url).upload_image(b"x")
    for status, code, cls in [(415, "unsupported_type", InvalidRequestError), (413, "too_large", NoteTooLargeError),
                              (507, "image_limit", LimitReachedError), (404, "not_found", NotFoundError)]:
        server.reply(status, {"error": code, "code": code})
        with pytest.raises(cls):
            Client(server.url, "inbox").upload_image(b"x")


def test_update_feed_sends_image_only_when_given(server):
    c = Client(server.url, "inbox")
    for kw in ({"image": "a.png"}, {"image": ""}, {}):
        server.reply(200, {"name": "inbox", "title": "t", "description": "d", "protected": False, "read_url": None, "image_url": None})
        c.update_feed("t", "d", **kw)
    assert [json.loads(r["body"]) for r in server.requests] == [
        {"title": "t", "description": "d", "image": "a.png"}, {"title": "t", "description": "d", "image": ""}, {"title": "t", "description": "d"}]
