"""The notefeed client: a small convenience layer over the API client generated from the server's
OpenAPI description (notefeed._generated, `npm run generate` in the repo)."""

from __future__ import annotations

import os
import re
from collections.abc import Callable, Iterator, Mapping
from typing import Any, TypeVar

import httpx

from ._generated import AuthenticatedClient
from ._generated import Client as _GeneratedClient
from ._generated.api.feeds import delete_feed, delete_note, edit_note, get_feed, get_note, list_notes, post_note, update_feed, upload_image
from ._generated.api.read import get_read_note, list_read_notes
from ._generated.models import Created, Feed, FeedSettings, ImageUploaded, Note, NoteList, PostJson
from ._generated.types import UNSET, File


_M = TypeVar("_M", Created, Feed, ImageUploaded, Note, NoteList)


class NotefeedError(Exception):
    """Any failure talking to notefeed. `status` and `code` are None when there was no API answer."""

    def __init__(self, message: str, status: int | None = None, code: str | None = None):
        super().__init__(message)
        self.status = status
        self.code = code


class ConfigError(NotefeedError):
    """Raised before sending: no URL, no feed, an invalid feed name or password."""


class AuthError(NotefeedError):
    """Missing or wrong password on a locked instance."""


class RateLimitedError(NotefeedError):
    """Too many posts or wrong passwords. `retry_after` is the wait in seconds, or None if none was given."""

    def __init__(self, message: str, status: int | None = None, code: str | None = None, retry_after: int | None = None):
        super().__init__(message, status, code)
        self.retry_after = retry_after


class NotFoundError(NotefeedError):
    """No such note, or a malformed read id."""


class LimitReachedError(NotefeedError):
    """The instance's feed or note limit, or the feed's image limit, is reached."""


class NoteTooLargeError(NotefeedError):
    """The note or image is over the server's size limit."""


class InvalidRequestError(NotefeedError):
    """The server refused the request itself: invalid or reserved feed, empty note, bad body or parameter."""


_BY_CODE: dict[str, type[NotefeedError]] = {
    "auth": AuthError,
    "rate_limited": RateLimitedError,
    "too_many_attempts": RateLimitedError,
    "not_found": NotFoundError,
    "feed_limit": LimitReachedError,
    "note_limit": LimitReachedError,
    "image_limit": LimitReachedError,
    "too_large": NoteTooLargeError,
    "invalid_feed": InvalidRequestError,
    "reserved_feed": InvalidRequestError,
    "empty_note": InvalidRequestError,
    "invalid_body": InvalidRequestError,
    "invalid_request": InvalidRequestError,
    "feed_exists": InvalidRequestError,
    "taken": InvalidRequestError,
    "unsupported_type": InvalidRequestError,
}

# Same rule as the server; reserved names still come back as a 400.
_FEED_RE = re.compile(r"[a-z0-9_-]{1,64}")


def _check_feed_password(value: str | None) -> str | None:
    value = (value or "").strip() or None
    if value and re.search(r"[\x00-\x1f\x7f]", value):
        raise ConfigError("feed password contains invalid characters")  # never echo the value
    return value


def _check_feed(feed: str) -> str:
    if not _FEED_RE.fullmatch(feed):
        raise ConfigError("invalid feed name: use 1-64 of a-z, 0-9, _ and -")  # never echo the name: it is the write key
    return feed


class Client:
    """A notefeed server. The feed set here is the default for every call; each call can override it.

    `timeout` (seconds) applies to connecting and to each read or write (httpx's semantics), not to a
    whole request. Close the client when done, or use it in a `with` block."""

    def __init__(
        self,
        url: str,
        feed: str | None = None,
        password: str | None = None,
        timeout: float = 10.0,
        feed_password: str | None = None,
    ):
        if not url:
            raise ConfigError("no url given")
        self.url = url.rstrip("/")
        self.feed = _check_feed(feed) if feed else None
        try:
            httpx.URL(self.url)
        except httpx.InvalidURL:
            raise ConfigError("invalid url") from None
        password = (password or "").strip() or None
        if password and re.search(r"[\x00-\x1f\x7f]", password):
            # Never echo the value: it would end up in terminals and CI logs.
            raise ConfigError("password contains invalid characters")
        self._feed_password = _check_feed_password(feed_password)
        # The generated clients: the authenticated one sends `Authorization: Bearer <password>` on every call.
        t = httpx.Timeout(timeout)
        self._api = (
            AuthenticatedClient(base_url=self.url, token=password, timeout=t)
            if password
            else _GeneratedClient(base_url=self.url, timeout=t)
        )

    def close(self) -> None:
        """Close the connection pool. Or use the client as a context manager: `with Client(...) as c:`."""
        self._api.get_httpx_client().close()

    def __enter__(self) -> Client:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    @classmethod
    def from_env(cls, environ: Mapping[str, str] = os.environ) -> Client:
        """NOTEFEED_URL, NOTEFEED_FEED, NOTEFEED_PASSWORD and NOTEFEED_FEED_PASSWORD."""
        return cls(
            environ.get("NOTEFEED_URL", ""),
            environ.get("NOTEFEED_FEED") or None,
            environ.get("NOTEFEED_PASSWORD"),
            feed_password=environ.get("NOTEFEED_FEED_PASSWORD"),
        )

    def post(
        self,
        markdown: str,
        feed: str | None = None,
        feed_password: str | None = None,
        tags: list[str] | None = None,
        read_id: str | None = None,
    ) -> Created:
        """`feed_password` overrides the client's, for a feed that has its own password. `tags` label the note
        (at most 10, each 1 to 32 characters of letters, digits, `-`, `_`, `.`, `:`; not verified). `read_id` is the
        read id the feed gets when this post creates it (3 to 64 characters of `a-z`, `0-9`, `-`, `_`; random when
        left out; ignored for a feed that exists; a `taken` error when another feed has it)."""
        body = PostJson(markdown=markdown, tags=tags or UNSET, read_id=read_id or UNSET)
        kwargs = post_note._get_kwargs(feed=self._feed_for(feed), body=body, x_feed_password=self._fp(feed_password))
        return self._parse(Created, self._call(kwargs))

    def upload_image(self, data: bytes, feed: str | None = None, feed_password: str | None = None) -> ImageUploaded:
        """Upload a PNG, JPEG, GIF or WebP image to an existing feed. The server decides the format by the bytes. `.markdown` is `![](file)`, relative to the feed so it follows a changed read id, to put in a note; use `.url` for a link outside notefeed. Same options as post()."""
        kwargs = upload_image._get_kwargs(
            feed=self._feed_for(feed), body=File(payload=data), x_feed_password=self._fp(feed_password)
        )
        return self._parse(ImageUploaded, self._call(kwargs))

    def edit(self, id: str, markdown: str, feed: str | None = None, feed_password: str | None = None) -> Note:
        """Replace a note's markdown; its id and URLs stay. Same options as post()."""
        kwargs = edit_note._get_kwargs(
            feed=self._feed_for(feed), id=id, body=PostJson(markdown=markdown), x_feed_password=self._fp(feed_password)
        )
        return self._parse(Note, self._call(kwargs))

    def delete(self, id: str, feed: str | None = None, feed_password: str | None = None) -> None:
        """Remove a note for good. The feed stays, even with no notes left. Same options as post()."""
        self._call(delete_note._get_kwargs(feed=self._feed_for(feed), id=id, x_feed_password=self._fp(feed_password)))

    def feed_info(self, feed: str | None = None, feed_password: str | None = None) -> Feed:
        """The feed's name, title, description, whether it has a password, and its read link (None while it has no notes). Same options as post()."""
        kwargs = get_feed._get_kwargs(feed=self._feed_for(feed), x_feed_password=self._fp(feed_password))
        return self._parse(Feed, self._call(kwargs))

    def update_feed(
        self,
        title: str,
        description: str,
        feed: str | None = None,
        feed_password: str | None = None,
        image: str | None = None,
        read_id: str | None = None,
    ) -> Feed:
        """Replace the feed's title and description (both; an empty string clears one). `image` sets the title image (a file name from upload_image), "" clears it, None keeps it. `read_id` gives the feed another read id (3 to 64 characters of `a-z`, `0-9`, `-`, `_`; "" for a random one; None keeps it); the old one is freed, and relative image links in notes follow while full URLs do not. The feed must already exist. Same options as post()."""
        settings = FeedSettings(
            title=title,
            description=description,
            image=UNSET if image is None else image,
            read_id=UNSET if read_id is None else read_id,
        )
        kwargs = update_feed._get_kwargs(feed=self._feed_for(feed), body=settings, x_feed_password=self._fp(feed_password))
        return self._parse(Feed, self._call(kwargs))

    def delete_feed(self, feed: str | None = None, feed_password: str | None = None) -> None:
        """Delete the feed with all its notes, settings and password, for good; its name is free again. Same options as post()."""
        self._call(delete_feed._get_kwargs(feed=self._feed_for(feed), x_feed_password=self._fp(feed_password)))

    def notes(
        self, feed: str | None = None, page_size: int = 50, feed_password: str | None = None, tag: str | None = None
    ) -> Iterator[Note]:
        """Every note in the feed, newest first, fetched a page at a time; stop iterating whenever you like.
        `tag`: only notes carrying it."""
        feed, fp = self._feed_for(feed), self._fp(feed_password)
        return self._pages(
            lambda before: list_notes._get_kwargs(
                feed=feed, limit=page_size, before=before, tag=tag or UNSET, x_feed_password=fp
            )
        )

    def note(self, id: str, feed: str | None = None, feed_password: str | None = None) -> Note:
        kwargs = get_note._get_kwargs(feed=self._feed_for(feed), id=id, x_feed_password=self._fp(feed_password))
        return self._parse(Note, self._call(kwargs))

    def read_notes(self, read_id: str, page_size: int = 50, tag: str | None = None) -> Iterator[Note]:
        """Like notes(), by the feed's read id: public, read-only, needs no password."""
        return self._pages(
            lambda before: list_read_notes._get_kwargs(read_id=read_id, limit=page_size, before=before, tag=tag or UNSET)
        )

    def read_note(self, read_id: str, id: str) -> Note:
        return self._parse(Note, self._call(get_read_note._get_kwargs(read_id=read_id, id=id)))

    def _fp(self, override: str | None) -> Any:
        return _check_feed_password(override) or self._feed_password or UNSET

    def _feed_for(self, feed: str | None) -> str:
        feed = feed or self.feed
        if not feed:
            raise ConfigError("no feed given")
        return _check_feed(feed)

    # `before` is the previous page's `next`: older notes only, so notes posted meanwhile never repeat.
    def _pages(self, kwargs_for: Callable[[Any], dict[str, Any]]) -> Iterator[Note]:
        before: Any = UNSET
        while True:
            page = self._parse(NoteList, self._call(kwargs_for(before)))
            yield from page.notes
            if not page.next_:
                return
            before = page.next_

    # A 2xx body the generated model can't read (missing fields, a bad date) is not the API's answer.
    def _parse(self, model: type[_M], body: dict[str, Any]) -> _M:
        try:
            return model.from_dict(body)
        except (KeyError, TypeError, ValueError):
            raise NotefeedError(f"unexpected response from {self.url} (not a notefeed server?)") from None

    # The generated request builders (_get_kwargs) and httpx client, but the response is read here: the
    # generated parsers assume every declared error status has a JSON body, and a proxy's HTML page doesn't.
    def _call(self, kwargs: dict[str, Any]) -> dict[str, Any]:
        try:
            response = self._api.get_httpx_client().request(**kwargs)
        except httpx.HTTPError as e:
            raise NotefeedError(f"could not reach {self.url}: {e}") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        if response.status_code == 204:  # delete: no body
            return {}
        if response.is_success and isinstance(body, dict):
            return body
        if response.is_success:
            raise NotefeedError(f"unexpected response from {self.url} (not a notefeed server?)", response.status_code)
        if response.is_redirect:
            target = httpx.URL(response.headers.get("Location", ""))
            where = f"{target.scheme}://{target.netloc.decode()}" if target.scheme else response.headers.get("Location", "elsewhere")
            raise NotefeedError(f"{self.url} redirected to {where}: use that address as the URL", response.status_code)
        code = body.get("code") if isinstance(body, dict) else None
        code = code if isinstance(code, str) else None
        if isinstance(body, dict) and isinstance(body.get("error"), str):
            message = body["error"]
        else:
            message = f"HTTP {response.status_code}: {' '.join(response.text[:200].split())}"
        cls = _BY_CODE.get(code or "", RateLimitedError if response.status_code == 429 else NotefeedError)
        if cls is RateLimitedError:
            retry = (response.headers.get("Retry-After") or "").strip()
            raise RateLimitedError(message, response.status_code, code, int(retry) if re.fullmatch(r"[0-9]+", retry) else None)
        raise cls(message, response.status_code, code)

