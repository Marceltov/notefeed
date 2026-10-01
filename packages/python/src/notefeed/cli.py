"""`notefeed post ...` and `notefeed notes ...`: post and read notes from the command line."""

from __future__ import annotations

import argparse
import io
import itertools
import json
import os
import sys
from datetime import timezone

from . import __version__
from .client import Client, ConfigError, Note, NotefeedError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="notefeed", description="Post and read markdown notes on notefeed.")
    parser.add_argument("--version", action="version", version=f"notefeed {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("post", help="post a note; prints its URL")
    p.add_argument("text", nargs="?", help='the markdown, or "-" to read stdin')
    p.add_argument("--file", help="read the markdown from this file")
    n = sub.add_parser("notes", help="print the newest notes: time, title, URL")
    n.add_argument("--limit", type=int, default=20, help="how many notes (default: 20)")
    n.add_argument("--json", action="store_true", help="one JSON object per line")
    for s_ in (p, n):
        s_.add_argument("--url", help="notefeed base URL (default: $NOTEFEED_URL)")
        s_.add_argument("--feed", help="feed name (default: $NOTEFEED_FEED)")
        s_.add_argument("--password", help="instance password, if it has one (default: $NOTEFEED_PASSWORD)")
    args = parser.parse_args(argv)

    try:
        if args.command == "post":
            markdown = _read(args)
            print(_client(args).post(markdown).url)
        else:
            if args.limit < 1:
                raise _UsageError("--limit must be a whole number, 1 or more")
            for note in itertools.islice(_client(args).notes(page_size=min(args.limit, 100)), args.limit):
                print(_line(note, args.json))
    except BrokenPipeError:
        # The reader went away (`notefeed notes | head -1`): stop quietly, and point stdout at devnull so
        # Python's own flush at exit doesn't complain about the closed pipe.
        try:
            os.dup2(os.open(os.devnull, os.O_WRONLY), sys.stdout.fileno())
        except (OSError, ValueError, io.UnsupportedOperation):
            pass
        return 0
    except (ConfigError, _UsageError) as e:
        print(f"notefeed: {e}", file=sys.stderr)
        return 2
    except NotefeedError as e:
        print(f"notefeed: {e}", file=sys.stderr)
        return 1
    return 0


def _client(args: argparse.Namespace) -> Client:
    """Flags win over NOTEFEED_URL, NOTEFEED_FEED and NOTEFEED_PASSWORD."""
    url = args.url or os.environ.get("NOTEFEED_URL")
    feed = args.feed or os.environ.get("NOTEFEED_FEED")
    if not url:
        raise _UsageError("no URL given; pass --url or set NOTEFEED_URL")
    if not feed:
        raise _UsageError("no feed given; pass --feed or set NOTEFEED_FEED")
    return Client(url, feed, args.password or os.environ.get("NOTEFEED_PASSWORD"))


def _line(note: Note, as_json: bool) -> str:
    # The same form as the JS CLI, so scripts read either the same way.
    when = note.created_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if as_json:
        return json.dumps({**note.to_dict(), "created_at": when}, ensure_ascii=False)
    return f"{when}  {note.title or note.id}  {note.url}"


class _UsageError(Exception):
    pass


def _read(args: argparse.Namespace) -> str:
    if args.file:
        try:
            with open(args.file, "rb") as f:
                return f.read().decode("utf-8")
        except OSError as e:
            raise _UsageError(f"cannot read {args.file}: {e.strerror}") from None
        except UnicodeDecodeError:
            raise _UsageError(f"{args.file} is not UTF-8") from None
    if args.text == "-":
        try:
            return sys.stdin.buffer.read().decode("utf-8")
        except UnicodeDecodeError:
            raise _UsageError("stdin is not UTF-8") from None
    if args.text is None:
        raise _UsageError('give the note text, "-" for stdin, or --file PATH')
    return args.text
