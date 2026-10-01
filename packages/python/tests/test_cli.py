import io
import json
import sys

from notefeed.cli import main


def sent(server, i=0):
    """The markdown the CLI posted (the client sends JSON {markdown})."""
    return json.loads(server.requests[i]["body"])["markdown"]


def test_post_text_prints_url(server, capsys):
    server.reply(201, {"id": "20260930T100000Z-i", "url": "https://n.example/inbox/i", "feed_url": "https://n.example/inbox", "read_url": "https://n.example/r/x/feed.xml"})
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
            "markdown": f"# Note {i}",
            "created_at": f"2026-09-30T10:{i:02d}:00.000Z",
            "url": f"https://n.example/inbox/n{i}",
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
