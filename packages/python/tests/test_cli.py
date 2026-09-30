import io
import sys

from notefeed.cli import main


def test_post_text_prints_url(server, capsys):
    server.reply(201, {"id": "i", "url": "https://n.example/n/i"})
    assert main(["post", "hi", "--url", server.url, "--token", "t"]) == 0
    assert capsys.readouterr().out.strip() == "https://n.example/n/i"
    assert server.requests[0]["body"] == b"hi"


def test_post_stdin(server, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO("# from stdin\r\nCafé\n".encode())))
    assert main(["post", "-", "--url", server.url, "--token", "t"]) == 0
    assert server.requests[0]["body"] == "# from stdin\r\nCafé\n".encode()


def test_post_file(server, tmp_path):
    f = tmp_path / "note.md"
    f.write_bytes("# File\r\nbody\n".encode())
    assert main(["post", "--file", str(f), "--url", server.url, "--token", "t"]) == 0
    assert server.requests[0]["body"] == b"# File\r\nbody\n"


def test_missing_file_exits_2(capsys, tmp_path):
    assert main(["post", "--file", str(tmp_path / "nope.md"), "--url", "http://x", "--token", "t"]) == 2
    assert capsys.readouterr().err.startswith("notefeed: ")


def test_no_text_exits_2_without_reading_stdin(capsys):
    assert main(["post", "--url", "http://x", "--token", "t"]) == 2
    assert "notefeed: " in capsys.readouterr().err


def test_no_config_exits_2(capsys):
    assert main(["post", "hi"]) == 2
    assert "NOTEFEED_URL" in capsys.readouterr().err


def test_server_error_exits_1(server, capsys):
    server.reply(401, {"error": "missing or wrong bearer token"})
    assert main(["post", "hi", "--url", server.url, "--token", "bad"]) == 1
    assert capsys.readouterr().err.strip() == "notefeed: missing or wrong bearer token"


def test_connection_refused_exits_1_one_line(capsys):
    assert main(["post", "hi", "--url", "http://127.0.0.1:1", "--token", "t"]) == 1
    err = capsys.readouterr().err
    assert err.startswith("notefeed: ") and err.count("\n") == 1


def test_version(capsys):
    try:
        main(["--version"])
    except SystemExit as e:
        assert e.code == 0
    assert capsys.readouterr().out.strip().endswith("0.1.0")


def test_file_not_utf8_exits_2(server, capsys, tmp_path):
    f = tmp_path / "latin1.md"
    f.write_bytes(b"# Caf\xe9\n")
    assert main(["post", "--file", str(f), "--url", server.url, "--token", "t"]) == 2
    assert "not UTF-8" in capsys.readouterr().err
    assert server.requests == []


def test_stdin_not_utf8_exits_2(server, capsys, monkeypatch):
    monkeypatch.setattr(sys, "stdin", io.TextIOWrapper(io.BytesIO(b"# Caf\xe9\n")))
    assert main(["post", "-", "--url", server.url, "--token", "t"]) == 2
    assert "not UTF-8" in capsys.readouterr().err
    assert server.requests == []


def test_list_item_text(server):
    assert main(["post", "- buy milk", "--url", server.url, "--token", "t"]) == 0
    assert server.requests[0]["body"] == b"- buy milk"
