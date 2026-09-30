"""A tiny client for notefeed's POST /<feed>. Standard library only."""

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
    read_url: str


class NotefeedError(Exception):
    """Any failure talking to notefeed. `status` is the HTTP status, or None (network, config)."""

    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


class ConfigError(NotefeedError):
    """URL or feed missing, or an invalid feed name or password."""


class InvalidNoteError(NotefeedError):
    """The server rejected the note (400, 415): empty, not UTF-8, wrong type."""


class AuthError(NotefeedError):
    """Missing or wrong password on a locked instance (401)."""


class NoteTooLargeError(NotefeedError):
    """The note is over the server's size limit (413)."""


class RateLimitedError(NotefeedError):
    """Too many requests (429). `retry_after` is the wait in seconds, or None if the server gave none."""

    def __init__(self, message: str, status: int | None = None, retry_after: int | None = None):
        super().__init__(message, status)
        self.retry_after = retry_after


class LimitReachedError(NotefeedError):
    """The server's feed or note limit is reached (507)."""


_ERRORS = {
    400: InvalidNoteError,
    415: InvalidNoteError,
    401: AuthError,
    413: NoteTooLargeError,
    429: RateLimitedError,
    507: LimitReachedError,
}

# Same rule as the server; reserved names still come back as a 400.
_FEED_RE = re.compile(r"[a-z0-9_-]{1,64}")


def _check_feed(feed: str) -> str:
    if not _FEED_RE.fullmatch(feed):
        raise ConfigError("invalid feed name: use 1-64 of a-z, 0-9, _ and -")  # never echo the name: it is the write key
    return feed


class Client:
    """A notefeed server. The feed set here is the default; post(feed=...) overrides it."""

    def __init__(self, url: str, feed: str | None = None, password: str | None = None, timeout: float = 10.0):
        if not url:
            raise ConfigError("no url given")
        self.url = url.rstrip("/")
        self.feed = _check_feed(feed) if feed else None
        self.password = (password or "").strip() or None
        if self.password and re.search(r"[\x00-\x1f\x7f]", self.password):
            # Never echo the value: it would end up in terminals and CI logs.
            raise ConfigError("password contains invalid characters")
        self.timeout = timeout

    def post(self, markdown: str, feed: str | None = None) -> Note:
        feed = feed or self.feed
        if not feed:
            raise ConfigError("no feed given")
        headers = {"Content-Type": "text/markdown; charset=utf-8"}
        if self.password:
            headers["Authorization"] = f"Bearer {self.password}"
        req = urllib.request.Request(
            f"{self.url}/{_check_feed(feed)}", data=markdown.encode("utf-8"), method="POST", headers=headers
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
            return Note(id=data["id"], url=data["url"], read_url=data["read_url"])
        except (ValueError, KeyError, TypeError):
            raise NotefeedError(f"unexpected response from {self.url} (not a notefeed server?)", status=status) from None


def _http_error(e: urllib.error.HTTPError) -> NotefeedError:
    text = e.read().decode("utf-8", errors="replace")
    try:
        message = json.loads(text)["error"]
    except (ValueError, KeyError, TypeError):
        message = f"HTTP {e.code}: {' '.join(text[:200].split())}"
    if e.code == 429:
        retry = (e.headers.get("Retry-After") or "").strip()
        return RateLimitedError(message, status=429, retry_after=int(retry) if retry.isdigit() else None)
    return _ERRORS.get(e.code, NotefeedError)(message, status=e.code)

