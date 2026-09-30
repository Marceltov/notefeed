"""A tiny client for notefeed's POST /api/notes. Standard library only."""

from __future__ import annotations

import http.client
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass


@dataclass(frozen=True)
class Note:
    id: str
    url: str


class NotefeedError(Exception):
    """Any failure talking to notefeed. `status` is the HTTP status, or None (network, config)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class ConfigError(NotefeedError):
    """URL or token missing."""


class InvalidNoteError(NotefeedError):
    """The server rejected the note (400, 415): empty, not UTF-8, wrong type."""


class AuthError(NotefeedError):
    """Missing or wrong token (401)."""


class NoteTooLargeError(NotefeedError):
    """The note is over the server's size limit (413)."""


_ERRORS = {400: InvalidNoteError, 415: InvalidNoteError, 401: AuthError, 413: NoteTooLargeError}


class Client:
    """A notefeed server. URL and token are set once here; post() takes only the note."""

    def __init__(self, url: str, token: str, timeout: float = 10.0):
        if not url:
            raise ConfigError("no url given")
        if not (token or "").strip():
            raise ConfigError("no token given")
        self.url = url.rstrip("/")
        self.token = token.strip()
        if re.search(r"[\x00-\x1f\x7f]", self.token):
            # Never echo the value: it would end up in terminals and CI logs.
            raise ConfigError("token contains invalid characters")
        self.timeout = timeout

    def post(self, markdown: str) -> Note:
        req = urllib.request.Request(
            f"{self.url}/api/notes",
            data=markdown.encode("utf-8"),
            method="POST",
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "text/markdown; charset=utf-8",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as res:
                status, text = res.status, res.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            raise _http_error(e) from None
        except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
            reason = getattr(e, "reason", e)
            raise NotefeedError(f"could not reach {self.url}: {reason}") from None
        try:
            data = json.loads(text)
            return Note(id=data["id"], url=data["url"])
        except (ValueError, KeyError, TypeError):
            raise NotefeedError(f"unexpected response from {self.url} (not a notefeed server?)", status=status) from None


def _http_error(e: urllib.error.HTTPError) -> NotefeedError:
    text = e.read().decode("utf-8", errors="replace")
    try:
        message = json.loads(text)["error"]
    except (ValueError, KeyError, TypeError):
        message = f"HTTP {e.code}: {' '.join(text[:200].split())}"
    return _ERRORS.get(e.code, NotefeedError)(message, status=e.code)

