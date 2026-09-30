"""`notefeed post ...` — post a note from the command line."""

from __future__ import annotations

import argparse
import sys

from . import __version__
from .client import Client, ConfigError, NotefeedError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="notefeed", description="Post markdown notes to notefeed.")
    parser.add_argument("--version", action="version", version=f"notefeed {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("post", help="post a note; prints its URL")
    p.add_argument("text", nargs="?", help='the markdown, or "-" to read stdin')
    p.add_argument("--file", help="read the markdown from this file")
    p.add_argument("--url", help="notefeed base URL (default: $NOTEFEED_URL)")
    p.add_argument("--token", help="API token (default: $NOTEFEED_TOKEN)")
    args = parser.parse_args(argv)

    try:
        markdown = _read(args)
        note = Client(args.url, args.token).post(markdown)
    except (ConfigError, _UsageError) as e:
        print(f"notefeed: {e}", file=sys.stderr)
        return 2
    except NotefeedError as e:
        print(f"notefeed: {e}", file=sys.stderr)
        return 1
    print(note.url)
    return 0


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
