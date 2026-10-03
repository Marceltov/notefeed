"""`notefeed post`, `edit`, `update`, `delete` and `notes`: post, change, remove and read notes, markdown or any accepted file, from the command line."""

from __future__ import annotations

import argparse
import io
import itertools
import json
import os
import re
import sys
from datetime import timezone
from pathlib import Path

from . import __version__
from .client import Attachment, Client, ConfigError, Note, NotefeedError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="notefeed", description="Post, edit, delete and read markdown notes on notefeed.")
    parser.add_argument("--version", action="version", version=f"notefeed {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("post", help="post a note; prints its URL")
    p.add_argument("text", nargs="?", help='the markdown, or "-" to read stdin')
    p.add_argument("--file", help="post this file (markdown or a picture; the type comes from its extension)")
    p.add_argument("--type", help="the file's media type, when the extension does not say")
    p.add_argument("--title", help="the note's title (default: taken from the text)")
    p.add_argument("--tag", action="append", help="label the note with this tag (repeat for several)")
    p.add_argument("--attach", action="append", metavar="PATH", help="a picture to post first and refer to as ![](its file name); repeat for several")
    e = sub.add_parser("edit", help="replace a note's content; prints its URL")
    e.add_argument("id", help="the note's id")
    e.add_argument("text", nargs="?", help='the new markdown, or "-" to read stdin')
    e.add_argument("--file", help="replace it with this file (of the note's own type)")
    e.add_argument("--type", help="the file's media type, when the extension does not say")
    u = sub.add_parser("update", help="set a note's title and/or alt text; prints its URL")
    u.add_argument("id", help="the note's id")
    u.add_argument("--title", help='the note\'s title ("" removes it)')
    u.add_argument("--alt", help='a picture\'s alternative text ("" removes it)')
    d = sub.add_parser("delete", help="delete a note; prints nothing")
    d.add_argument("id", help="the note's id")
    n = sub.add_parser("notes", help="print the newest notes: time, title, URL")
    n.add_argument("--limit", type=int, default=20, help="how many notes (default: 20)")
    n.add_argument("--json", action="store_true", help="one JSON object per line")
    n.add_argument("--tag", help="only notes carrying this tag")
    for s_ in (p, e, u, d, n):
        s_.add_argument("--url", help="notefeed base URL (default: $NOTEFEED_URL)")
        s_.add_argument("--feed", help="feed name (default: $NOTEFEED_FEED)")
        s_.add_argument("--password", help="instance password, if it has one (default: $NOTEFEED_PASSWORD)")
    args = parser.parse_args(argv)

    try:
        if args.command == "post":
            content, media, name = _read(args)
            attachments = [_attachment(path) for path in args.attach or []]
            note = _client(args).post(content, type=media, title=args.title, tags=args.tag, name=name, attachments=attachments)
            print("\n".join([note.url, *(a.url for a in note.attachments)]))
        elif args.command == "edit":
            content, media, _ = _read(args)
            print(_client(args).edit(args.id, content, type=media).url)
        elif args.command == "update":
            if args.title is None and args.alt is None:
                raise _UsageError("give --title and/or --alt")
            print(_client(args).update(args.id, title=args.title, alt=args.alt).url)
        elif args.command == "delete":
            _client(args).delete(args.id)
        else:
            if args.limit < 1:
                raise _UsageError("--limit must be a whole number, 1 or more")
            for note in itertools.islice(_client(args).notes(page_size=min(args.limit, 100), tag=args.tag), args.limit):
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
    """Flags win over NOTEFEED_URL, NOTEFEED_FEED and NOTEFEED_PASSWORD. NOTEFEED_FEED_PASSWORD has no flag: it would end up in shell history."""
    url = args.url or os.environ.get("NOTEFEED_URL")
    feed = args.feed or os.environ.get("NOTEFEED_FEED")
    if not url:
        raise _UsageError("no URL given; pass --url or set NOTEFEED_URL")
    if not feed:
        raise _UsageError("no feed given; pass --feed or set NOTEFEED_FEED")
    return Client(
        url,
        feed,
        args.password or os.environ.get("NOTEFEED_PASSWORD"),
        feed_password=os.environ.get("NOTEFEED_FEED_PASSWORD"),
    )


def _line(note: Note, as_json: bool) -> str:
    # The same form as the JS CLI, so scripts read either the same way.
    when = note.created_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if as_json:
        keys = ("id", "type", "title", "content", "file", "file_url", "size", "tags", "created_at", "url")
        fields = {**note.to_dict(), "created_at": when}
        return json.dumps({k: fields[k] for k in keys if k in fields}, ensure_ascii=False)
    return f"{when}  {note.title or note.id}  {note.url}"


class _UsageError(Exception):
    pass


# The media type of a file by its extension: the types the server accepts.
_TYPES = {".md": "text/markdown", ".markdown": "text/markdown", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}


def _attachment(path: str) -> Attachment:
    """A picture to post first: its name is the file's, its type comes from the extension."""
    media = _TYPES.get(Path(path).suffix.lower())
    if not media or media == "text/markdown":
        raise _UsageError(f"cannot attach {path}: a picture ({', '.join(e for e, t in _TYPES.items() if t != 'text/markdown')}) is expected")
    name = Path(path).name
    if not re.fullmatch(r"(?!\.+$)[A-Za-z0-9._-]+", name):
        raise _UsageError(f'cannot attach {path}: its file name "{name}" is what the text refers to it by, so it may only have letters, digits, ., _ and -: rename the file')
    try:
        return Attachment(name, Path(path).read_bytes(), media)
    except OSError as e:
        raise _UsageError(f"cannot read {path}: {e.strerror}") from None


def _read(args: argparse.Namespace) -> tuple[str | bytes, str | None, str | None]:
    """What a post or an edit sends: text on the command line or stdin is markdown; a file is sent as it is, as --type or its extension says."""
    if args.file:
        media = args.type or _TYPES.get(Path(args.file).suffix.lower())
        if not media:
            raise _UsageError(f"cannot tell the type of {args.file}: pass --type ({', '.join(dict.fromkeys(_TYPES.values()))})")
        try:
            with open(args.file, "rb") as f:
                data = f.read()
        except OSError as e:
            raise _UsageError(f"cannot read {args.file}: {e.strerror}") from None
        if media == "text/markdown":
            try:
                return data.decode("utf-8"), media, Path(args.file).name
            except UnicodeDecodeError:
                raise _UsageError(f"{args.file} is not UTF-8") from None
        return data, media, Path(args.file).name
    if args.text == "-":
        try:
            return sys.stdin.buffer.read().decode("utf-8"), args.type, None
        except UnicodeDecodeError:
            raise _UsageError("stdin is not UTF-8") from None
    if args.text is None:
        raise _UsageError('give the note text, "-" for stdin, or --file PATH')
    return args.text, args.type, None
