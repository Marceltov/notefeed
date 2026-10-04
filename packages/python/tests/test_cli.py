import email.parser
import email.policy
import io
import json
import sys

from notefeed.cli import main


def sent(server, i=0):
    """What the CLI sent: the body is the file itself, its Content-Type the type."""
    return server.requests[i]["body"].decode("utf-8")


def type_of(server, i=0):
    return server.requests[i]["headers"]["Content-Type"]


def test_post_text_prints_url(server, capsys):
    server.reply(201, {"id": "20260930T100000Z-i", "url": "https://n.example/inbox/i", "feed_url": "https://n.example/inbox", "read_url": "https://n.example/r/x/feed.xml", "file": "i.md", "file_url": "https://n.example/r/x/i.md"})
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out.strip() == "https://n.example/inbox/i"
    assert sent(server) == "hi"


def test_post_stdin(server, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO("# from stdin\r\nCafé\n".encode())))
    assert main(["post", "-", "--url", server.url, "--feed", "inbox"]) == 0
    assert sent(server) == "# from stdin\r\nCafé\n"


def test_post_file(server, tmp_path):
    f = tmp_path / "note.md"
    f.write_bytes("# File\r\nbody\n".encode())
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 0
    assert sent(server) == "# File\r\nbody\n"


def test_missing_file_exits_2(capsys, tmp_path):
    assert main(["post", "--file", str(tmp_path / "nope.md"), "--url", "http://x", "--feed", "inbox"]) == 2
    assert capsys.readouterr().err.startswith("notefeed: ")


def test_no_text_exits_2_without_reading_stdin(capsys):
    assert main(["post", "--url", "http://x", "--feed", "inbox"]) == 2
    assert "notefeed: " in capsys.readouterr().err


def test_no_config_exits_2(capsys):
    assert main(["post", "hi"]) == 2
    assert "NOTEFEED_URL" in capsys.readouterr().err


def test_server_error_exits_1(server, capsys):
    server.reply(401, {"error": "missing or wrong password"})
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox", "--password", "bad"]) == 1
    assert capsys.readouterr().err.strip() == "notefeed: missing or wrong password"


def test_connection_refused_exits_1_one_line(capsys):
    assert main(["post", "hi", "--url", "http://127.0.0.1:1", "--feed", "inbox"]) == 1
    err = capsys.readouterr().err
    assert err.startswith("notefeed: ") and err.count("\n") == 1


def test_version(capsys):
    try:
        main(["--version"])
    except SystemExit as e:
        assert e.code == 0
    import notefeed

    assert capsys.readouterr().out.strip() == f"notefeed {notefeed.__version__}"


def test_file_not_utf8_exits_2(server, capsys, tmp_path):
    f = tmp_path / "latin1.md"
    f.write_bytes(b"# Caf\xe9\n")
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 2
    assert "not UTF-8" in capsys.readouterr().err
    assert server.requests == []


def test_stdin_not_utf8_exits_2(server, capsys, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(b"# Caf\xe9\n")))
    assert main(["post", "-", "--url", server.url, "--feed", "inbox"]) == 2
    assert "not UTF-8" in capsys.readouterr().err
    assert server.requests == []


def test_list_item_text(server):
    assert main(["post", "- buy milk", "--url", server.url, "--feed", "inbox"]) == 0
    assert sent(server) == "- buy milk"


def test_env_vars(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", server.url)
    monkeypatch.setenv("NOTEFEED_FEED", "envfeed")
    monkeypatch.setenv("NOTEFEED_PASSWORD", "envpw")
    assert main(["post", "- buy milk"]) == 0
    req = server.requests[0]
    assert req["path"] == "/api/v1/feeds/envfeed/notes"
    assert req["headers"]["Authorization"] == "Bearer envpw"
    assert sent(server) == "- buy milk"


def test_flags_win_over_env(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("NOTEFEED_FEED", "envfeed")
    monkeypatch.setenv("NOTEFEED_PASSWORD", "envpw")
    assert main(["post", "hi", "--url", server.url, "--feed", "argfeed", "--password", "argpw"]) == 0
    req = server.requests[0]
    assert req["path"] == "/api/v1/feeds/argfeed/notes"
    assert req["headers"]["Authorization"] == "Bearer argpw"


def test_feed_password_from_env(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_FEED_PASSWORD", "fp")
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert server.requests[0]["headers"]["X-Feed-Password"] == "fp"


def test_no_feed_password_sends_no_header(server):
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert "X-Feed-Password" not in server.requests[0]["headers"]


def test_feed_exists_exits_1(server, capsys):
    server.reply(409, {"error": "feed exists", "code": "feed_exists"})
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 1
    assert capsys.readouterr().err == "notefeed: feed exists\n"


def test_no_password_sends_no_auth(server):
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert "Authorization" not in server.requests[0]["headers"]


def test_no_feed_exits_2_naming_flag_and_env(server, capsys):
    assert main(["post", "hi", "--url", server.url]) == 2
    err = capsys.readouterr().err
    assert "--feed" in err and "NOTEFEED_FEED" in err
    assert server.requests == []


def test_invalid_feed_exits_2(server, capsys):
    assert main(["post", "hi", "--url", server.url, "--feed", "Not/Valid"]) == 2
    assert "invalid feed name" in capsys.readouterr().err
    assert server.requests == []


# notefeed notes


def serve_notes(server, count):
    """A feed of `count` notes, served a page at a time like the server."""
    from urllib.parse import parse_qs, urlparse

    notes = [
        {
            "id": f"20260930T10{i:02d}00Z-n{i}",
            "title": f"Note {i}",
            "content": f"# Note {i}",
            "created_at": f"2026-09-30T10:{i:02d}:00.000Z",
            "url": f"https://n.example/inbox/n{i}",
            "type": "text/markdown",
            "file_url": f"https://n.example/r/X/20260930T10{i:02d}00Z-n{i}.md",
            "file": f"20260930T10{i:02d}00Z-n{i}.md",
            "size": 4,
            "tags": [],
        }
        for i in range(count)
    ][::-1]

    def route(method, path):
        q = parse_qs(urlparse(path).query)
        limit = int(q.get("limit", ["50"])[0])
        before = q.get("before", [None])[0]
        older = [n for n in notes if not before or n["id"] < before]
        return 200, {"notes": older[:limit], "next": older[limit - 1]["id"] if len(older) > limit else None}

    server.route = route


def notes_args(server, *extra):
    return ["notes", "--url", server.url, "--feed", "inbox", *extra]


def test_notes_prints_newest_with_limit(server, capsys):
    serve_notes(server, 5)
    assert main(notes_args(server, "--limit", "3")) == 0
    assert capsys.readouterr().out == (
        "2026-09-30T10:04:00Z  Note 4  https://n.example/inbox/n4\n"
        "2026-09-30T10:03:00Z  Note 3  https://n.example/inbox/n3\n"
        "2026-09-30T10:02:00Z  Note 2  https://n.example/inbox/n2\n"
    )


def test_notes_defaults_to_twenty_across_pages(server, capsys):
    serve_notes(server, 30)
    assert main(notes_args(server)) == 0
    assert len(capsys.readouterr().out.strip().splitlines()) == 20


def test_notes_json(server, capsys):
    serve_notes(server, 2)
    assert main(notes_args(server, "--json")) == 0
    assert [json.loads(line)["title"] for line in capsys.readouterr().out.strip().splitlines()] == ["Note 1", "Note 0"]


def test_notes_without_feed_is_a_usage_error(server, capsys):
    assert main(["notes", "--url", server.url]) == 2
    assert "no feed given" in capsys.readouterr().err


def test_notes_auth_error_exits_1(server, capsys):
    server.route = lambda method, path: (401, {"error": "missing or wrong password", "code": "auth"})
    assert main(notes_args(server)) == 1
    assert capsys.readouterr().err == "notefeed: missing or wrong password\n"


def test_notes_rejects_a_bad_limit(server, capsys):
    assert main(notes_args(server, "--limit", "0")) == 2


def test_notes_json_prints_exactly_the_documented_fields(server, capsys):
    server.route = lambda method, path: (
        200,
        {"notes": [{"id": "20260930T100000Z-a", "type": "text/markdown", "title": "A", "content": "# A", "file": "a.md", "file_url": None, "size": 3, "tags": ["x"], "created_at": "2026-09-30T10:00:00.000Z", "url": "https://n/a", "mood": "new"}], "next": None},
    )
    assert main(notes_args(server, "--json")) == 0
    assert list(json.loads(capsys.readouterr().out)) == ["id", "type", "title", "content", "file", "file_url", "size", "tags", "created_at", "url"]  # the unknown "mood" is dropped


def test_notes_stops_quietly_when_the_reader_goes_away(server, capsys, monkeypatch):
    """`notefeed notes --limit 1000 | head -1`: the pipe closes after the first line."""
    serve_notes(server, 5)

    class ClosedPipe(io.StringIO):
        def write(self, s):
            raise BrokenPipeError

    monkeypatch.setattr(sys, "stdout", ClosedPipe())
    assert main(notes_args(server, "--limit", "1000")) == 0
    assert capsys.readouterr().err == ""


NOTE = {"id": "i", "type": "text/markdown", "title": "T", "content": "x", "file": "i.md", "file_url": "https://n.example/r/X/i.md", "size": 1, "tags": [], "created_at": "2026-09-30T10:00:00.000Z", "url": "https://n.example/inbox/i"}
CREATED = {"id": "a", "url": "https://n.example/inbox/a", "feed_url": "https://n.example/inbox", "read_url": None, "file": "a.png", "file_url": "https://n.example/r/X/a.png"}


def test_edit_text_prints_url(server, capsys):
    server.reply(200, NOTE)
    assert main(["edit", "i", "new", "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out == "https://n.example/inbox/i\n"
    assert (server.requests[0]["method"], server.requests[0]["path"]) == ("PUT", "/api/v1/feeds/inbox/notes/i")
    assert sent(server) == "new"


def test_edit_stdin_and_file(server, monkeypatch, tmp_path):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(b"from stdin")))
    server.reply(200, NOTE)
    assert main(["edit", "i", "-", "--url", server.url, "--feed", "inbox"]) == 0
    assert sent(server) == "from stdin"
    f = tmp_path / "n.md"
    f.write_text("from file")
    server.reply(200, NOTE)
    assert main(["edit", "i", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 0
    assert sent(server, 1) == "from file"


def test_edit_needs_text(capsys):
    assert main(["edit", "i", "--url", "http://x", "--feed", "inbox"]) == 2


def test_delete_prints_nothing_and_sends_feed_password(server, capsys, monkeypatch):
    monkeypatch.setenv("NOTEFEED_FEED_PASSWORD", "fp")
    server.reply(204, "")
    assert main(["delete", "i", "--url", server.url, "--feed", "inbox", "--password", "pw"]) == 0
    assert capsys.readouterr() == ("", "")
    r = server.requests[0]
    assert (r["method"], r["path"], r["headers"]["X-Feed-Password"], r["headers"]["Authorization"]) == (
        "DELETE", "/api/v1/feeds/inbox/notes/i", "fp", "Bearer pw")


def test_delete_errors(server, capsys):
    server.reply(404, {"error": "no such note", "code": "not_found"})
    assert main(["delete", "i", "--url", server.url, "--feed", "inbox"]) == 1
    assert capsys.readouterr().err == "notefeed: no such note\n"
    assert main(["delete", "i", "--url", server.url]) == 2


def test_post_declares_markdown_for_text_and_files(server, tmp_path):
    server.reply(201, CREATED)
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert type_of(server) == "text/markdown"
    f = tmp_path / "n.md"
    f.write_text("# File\n")
    server.reply(201, CREATED)
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 0
    assert type_of(server, 1) == "text/markdown"


def test_post_a_picture_file_sends_its_bytes_as_its_type(server, capsys, tmp_path):
    f = tmp_path / "Photo.PNG"
    png = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 255])
    f.write_bytes(png)
    server.reply(201, CREATED)
    assert main(["post", "--file", str(f), "--title", "Café", "--tag", "pets", "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out == "https://n.example/inbox/a\n"
    q = server.requests[0]
    assert (q["body"], q["headers"]["Content-Type"], q["headers"]["X-Note-Tags"], q["headers"]["X-Note-Name"]) == (png, "image/png", "pets", "Photo.PNG")
    assert q["headers"]["X-Note-Title"].encode("latin-1").decode("utf-8") == "Café"


def test_post_type_flag_wins_and_an_unknown_extension_needs_it(server, capsys, tmp_path):
    f = tmp_path / "data.bin"
    f.write_bytes(bytes([0xFF, 0xD8, 0xFF, 0xE0, 0]))
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 2
    assert "--type" in capsys.readouterr().err
    server.reply(201, CREATED)
    assert main(["post", "--file", str(f), "--type", "image/jpeg", "--url", server.url, "--feed", "inbox"]) == 0
    assert type_of(server) == "image/jpeg"


def test_post_a_refused_file_exits_like_any_error(server, capsys, tmp_path):
    f = tmp_path / "x.png"
    f.write_text("not a png")
    server.reply(415, {"error": "send a Content-Type of text/markdown, image/png", "code": "unsupported_type"})
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 1
    assert capsys.readouterr().err == "notefeed: send a Content-Type of text/markdown, image/png\n"
    assert main(["post", "--file", "/nonexistent/x.png", "--url", "http://x", "--feed", "inbox"]) == 2


def test_update_sets_title_and_alt(server, capsys):
    server.reply(200, NOTE)
    assert main(["update", "i", "--title", "T", "--alt", "A", "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out == "https://n.example/inbox/i\n"
    q = server.requests[0]
    assert (q["method"], q["path"], json.loads(q["body"])) == ("PATCH", "/api/v1/feeds/inbox/notes/i", {"title": "T", "alt": "A"})
    assert main(["update", "i", "--url", server.url, "--feed", "inbox"]) == 2  # nothing to change


def test_edit_a_picture_file_sends_it_as_its_type(server, tmp_path):
    f = tmp_path / "x.webp"
    f.write_bytes(b"RIFF....WEBPVP8 ")
    server.reply(200, NOTE)
    assert main(["edit", "i", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 0
    assert (server.requests[0]["method"], type_of(server)) == ("PUT", "image/webp")


# --attach: pictures and text in one multipart request.
PNG = bytes([0x89, 0x50, 0x4E, 0x47])


def _img(n, ext="png"):
    return {"id": f"I{n}", "url": f"https://n.example/inbox/I{n}", "feed_url": "https://n.example/inbox", "read_url": None, "file": f"F{n}.{ext}", "file_url": "x"}


_TEXT = {"id": "T", "url": "https://n.example/inbox/T", "feed_url": "https://n.example/inbox", "read_url": None, "file": "T.md", "file_url": "x"}


def _pics(tmp_path):
    for name, data in (("chart.png", PNG), ("t.webp", PNG), ("notes.md", b"# x")):
        (tmp_path / name).write_bytes(data)
    return tmp_path


def _parts(server, i=0):
    """The multipart parts of request i as (name, filename, content type, payload)."""
    r = server.requests[i]
    msg = email.parser.BytesParser(policy=email.policy.HTTP).parsebytes(b"Content-Type: " + r["headers"]["Content-Type"].encode() + b"\r\n\r\n" + r["body"])
    return [(p.get_param("name", header="content-disposition"), p.get_filename(), p.get_content_type(), p.get_payload(decode=True)) for p in msg.iter_parts()]


def test_attach_sends_one_multipart_request_and_prints_the_text_url_then_the_image_urls(server, capsys, tmp_path):
    d = _pics(tmp_path)
    server.reply(201, {**_TEXT, "attachments": [_img(1), _img(2, "webp")]})
    assert main(["post", "see ![](chart.png)", "--attach", str(d / "chart.png"), "--attach", str(d / "t.webp"), "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out.split() == ["https://n.example/inbox/T", "https://n.example/inbox/I1", "https://n.example/inbox/I2"]
    assert len(server.requests) == 1
    assert type_of(server).startswith("multipart/form-data; boundary=")
    assert _parts(server) == [
        ("text", "text.md", "text/markdown", b"see ![](chart.png)"),
        ("file", "chart.png", "image/png", PNG),
        ("file", "t.webp", "image/webp", PNG),
    ]


def test_attach_without_text_sends_no_text_part_and_prints_each_picture_url_once(server, capsys, tmp_path):
    d = _pics(tmp_path)
    server.reply(201, {**_img(1), "attachments": [_img(1), _img(2)]})
    assert main(["post", "--attach", str(d / "chart.png"), "--attach", str(d / "t.webp"), "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out.split() == ["https://n.example/inbox/I1", "https://n.example/inbox/I2"]
    assert [p[:2] for p in _parts(server)] == [("file", "chart.png"), ("file", "t.webp")]


def test_attach_without_text_sends_the_title_and_tags_as_headers_and_no_text_part(server, tmp_path):
    d = _pics(tmp_path)
    server.reply(201, {**_img(1), "attachments": [_img(1)]})
    assert main(["post", "--attach", str(d / "chart.png"), "--title", "T", "--tag", "a", "--tag", "b", "--url", server.url, "--feed", "inbox"]) == 0
    headers = server.requests[0]["headers"]
    assert (headers["X-Note-Title"], headers["X-Note-Tags"]) == ("T", "a,b")
    assert [p[:2] for p in _parts(server)] == [("file", "chart.png")]


def test_attach_with_stdin_sends_the_stdin_text_as_the_text_part(server, capsys, monkeypatch, tmp_path):
    d = _pics(tmp_path)
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(b"# from stdin\r\n![](chart.png)\n")))
    server.reply(201, {**_TEXT, "attachments": [_img(1)]})
    assert main(["post", "-", "--attach", str(d / "chart.png"), "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out.split() == ["https://n.example/inbox/T", "https://n.example/inbox/I1"]
    assert _parts(server) == [("text", "text.md", "text/markdown", b"# from stdin\r\n![](chart.png)\n"), ("file", "chart.png", "image/png", PNG)]


def test_attach_unreadable_markdown_or_unknown_extension_exits_2_and_posts_nothing(server, capsys, tmp_path):
    d = _pics(tmp_path)
    for path in ("/nonexistent/x.png", str(d / "notes.md"), str(d / "chart.xyz")):
        assert main(["post", "hi", "--attach", path, "--url", server.url, "--feed", "inbox"]) == 2
        assert capsys.readouterr().err.startswith("notefeed: cannot ")
    assert server.requests == []


def test_attach_refused_exits_1_naming_the_attachment_and_prints_nothing(server, capsys, tmp_path):
    d = _pics(tmp_path)
    server.reply(400, {"error": 'attachment "t.webp": bad image', "code": "invalid_body"})
    assert main(["post", "hi", "--attach", str(d / "chart.png"), "--attach", str(d / "t.webp"), "--url", server.url, "--feed", "inbox"]) == 1
    out = capsys.readouterr()
    assert out.out == ""
    assert out.err == 'notefeed: attachment "t.webp": bad image\n'
    assert len(server.requests) == 1


def test_attach_name_with_a_space_is_accepted_and_sent_with_that_filename(server, tmp_path):
    (tmp_path / "my chart.png").write_bytes(PNG)
    server.reply(201, {**_TEXT, "attachments": [_img(1)]})
    assert main(["post", "hi", "--attach", str(tmp_path / "my chart.png"), "--url", server.url, "--feed", "inbox"]) == 0
    assert _parts(server)[1][:2] == ("file", "my chart.png")


def test_attach_with_a_non_markdown_file_exits_2_and_posts_nothing(server, tmp_path):
    d = _pics(tmp_path)
    assert main(["post", "--file", str(d / "chart.png"), "--attach", str(d / "t.webp"), "--url", server.url, "--feed", "inbox"]) == 2
    assert server.requests == []


def test_attach_with_a_markdown_file_is_one_request_with_its_text(server, tmp_path):
    d = _pics(tmp_path)
    server.reply(201, {**_TEXT, "attachments": [_img(1)]})
    assert main(["post", "--file", str(d / "notes.md"), "--attach", str(d / "chart.png"), "--url", server.url, "--feed", "inbox"]) == 0
    assert _parts(server)[0] == ("text", "text.md", "text/markdown", b"# x")
