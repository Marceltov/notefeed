import io
import sys

from notefeed.cli import main


def test_post_text_prints_url(server, capsys):
    server.reply(201, {"id": "i", "url": "https://n.example/inbox/i", "read_url": "https://n.example/r/x/feed.xml"})
    assert main(["post", "hi", "--url", server.url, "--feed", "inbox"]) == 0
    assert capsys.readouterr().out.strip() == "https://n.example/inbox/i"
    assert server.requests[0]["body"] == b"hi"


def test_post_stdin(server, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO("# from stdin\r\nCafé\n".encode())))
    assert main(["post", "-", "--url", server.url, "--feed", "inbox"]) == 0
    assert server.requests[0]["body"] == "# from stdin\r\nCafé\n".encode()


def test_post_file(server, tmp_path):
    f = tmp_path / "note.md"
    f.write_bytes("# File\r\nbody\n".encode())
    assert main(["post", "--file", str(f), "--url", server.url, "--feed", "inbox"]) == 0
    assert server.requests[0]["body"] == b"# File\r\nbody\n"


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
    assert server.requests[0]["body"] == b"- buy milk"


def test_env_vars(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", server.url)
    monkeypatch.setenv("NOTEFEED_FEED", "envfeed")
    monkeypatch.setenv("NOTEFEED_PASSWORD", "envpw")
    assert main(["post", "- buy milk"]) == 0
    req = server.requests[0]
    assert req["path"] == "/envfeed"
    assert req["headers"]["Authorization"] == "Bearer envpw"
    assert req["body"] == b"- buy milk"


def test_flags_win_over_env(server, monkeypatch):
    monkeypatch.setenv("NOTEFEED_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("NOTEFEED_FEED", "envfeed")
    monkeypatch.setenv("NOTEFEED_PASSWORD", "envpw")
    assert main(["post", "hi", "--url", server.url, "--feed", "argfeed", "--password", "argpw"]) == 0
    req = server.requests[0]
    assert req["path"] == "/argfeed"
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
