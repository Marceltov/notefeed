from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.created import Created
from ...models.error import Error
from ...models.post_json import PostJson
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: PostJson,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    if not isinstance(x_note_tags, Unset):
        headers["X-Note-Tags"] = x_note_tags

    if not isinstance(x_note_name, Unset):
        headers["X-Note-Name"] = x_note_name

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/notes".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | Created | Error | None:
    if response.status_code == 201:
        response_201 = Created.from_dict(response.json())

        return response_201

    if response.status_code == 303:
        response_303 = cast(Any, None)
        return response_303

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

    if response.status_code == 413:
        response_413 = Error.from_dict(response.json())

        return response_413

    if response.status_code == 415:
        response_415 = Error.from_dict(response.json())

        return response_415

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if response.status_code == 507:
        response_507 = Error.from_dict(response.json())

        return response_507

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Any | Created | Error]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
) -> Response[Any | Created | Error]:
    """Post a note

     Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password`
    header or a `password` field in the JSON or form body; 1 to 256 printable ASCII characters, with no
    space at the start or end). Posting to a protected feed needs that password. Also served at `POST
    /{feed}`, the short form the client packages and curl one-liners use. A markdown body is at most
    102400 bytes and must be UTF-8. A body that is an image (`image/png`, `image/jpeg`, `image/gif`,
    `image/webp` or `application/octet-stream`) is posted as a note of its own: PNG, JPEG, GIF or WebP,
    recognized by its first bytes, whatever `Content-Type` is sent (SVG is refused). It is stored byte
    for byte, with no resizing and no metadata stripped (EXIF such as GPS position stays in the file),
    at most NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB). The response has its `file` and a `file_url` under
    the feed's read id, public like the read link. `X-Note-Name` gives the picture's original file name.
    A multipart form may send a `file` part instead of `markdown`. `application/x-www-form-urlencoded`
    (what `curl -d` sends) is read as raw markdown, not as form fields. `read_id` (JSON or form field)
    is the feed's read id when this post creates it: random when left out, ignored for a feed that
    exists. Tags (at most 10 tags, each 1 to 32 characters of letters, digits, `-`, `_`, `.` and `:`;
    case is folded to lowercase, duplicates are removed) go in the JSON `tags` array, a repeated `tags`
    form field, or, for a raw body, the `X-Note-Tags` header.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        body (PostJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Created | Error]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
        x_note_name=x_note_name,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
) -> Any | Created | Error | None:
    """Post a note

     Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password`
    header or a `password` field in the JSON or form body; 1 to 256 printable ASCII characters, with no
    space at the start or end). Posting to a protected feed needs that password. Also served at `POST
    /{feed}`, the short form the client packages and curl one-liners use. A markdown body is at most
    102400 bytes and must be UTF-8. A body that is an image (`image/png`, `image/jpeg`, `image/gif`,
    `image/webp` or `application/octet-stream`) is posted as a note of its own: PNG, JPEG, GIF or WebP,
    recognized by its first bytes, whatever `Content-Type` is sent (SVG is refused). It is stored byte
    for byte, with no resizing and no metadata stripped (EXIF such as GPS position stays in the file),
    at most NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB). The response has its `file` and a `file_url` under
    the feed's read id, public like the read link. `X-Note-Name` gives the picture's original file name.
    A multipart form may send a `file` part instead of `markdown`. `application/x-www-form-urlencoded`
    (what `curl -d` sends) is read as raw markdown, not as form fields. `read_id` (JSON or form field)
    is the feed's read id when this post creates it: random when left out, ignored for a feed that
    exists. Tags (at most 10 tags, each 1 to 32 characters of letters, digits, `-`, `_`, `.` and `:`;
    case is folded to lowercase, duplicates are removed) go in the JSON `tags` array, a repeated `tags`
    form field, or, for a raw body, the `X-Note-Tags` header.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        body (PostJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Created | Error
    """

    return sync_detailed(
        feed=feed,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
        x_note_name=x_note_name,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
) -> Response[Any | Created | Error]:
    """Post a note

     Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password`
    header or a `password` field in the JSON or form body; 1 to 256 printable ASCII characters, with no
    space at the start or end). Posting to a protected feed needs that password. Also served at `POST
    /{feed}`, the short form the client packages and curl one-liners use. A markdown body is at most
    102400 bytes and must be UTF-8. A body that is an image (`image/png`, `image/jpeg`, `image/gif`,
    `image/webp` or `application/octet-stream`) is posted as a note of its own: PNG, JPEG, GIF or WebP,
    recognized by its first bytes, whatever `Content-Type` is sent (SVG is refused). It is stored byte
    for byte, with no resizing and no metadata stripped (EXIF such as GPS position stays in the file),
    at most NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB). The response has its `file` and a `file_url` under
    the feed's read id, public like the read link. `X-Note-Name` gives the picture's original file name.
    A multipart form may send a `file` part instead of `markdown`. `application/x-www-form-urlencoded`
    (what `curl -d` sends) is read as raw markdown, not as form fields. `read_id` (JSON or form field)
    is the feed's read id when this post creates it: random when left out, ignored for a feed that
    exists. Tags (at most 10 tags, each 1 to 32 characters of letters, digits, `-`, `_`, `.` and `:`;
    case is folded to lowercase, duplicates are removed) go in the JSON `tags` array, a repeated `tags`
    form field, or, for a raw body, the `X-Note-Tags` header.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        body (PostJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Created | Error]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
        x_note_name=x_note_name,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
) -> Any | Created | Error | None:
    """Post a note

     Creates the feed with its first note, optionally protected by its own password (`X-Feed-Password`
    header or a `password` field in the JSON or form body; 1 to 256 printable ASCII characters, with no
    space at the start or end). Posting to a protected feed needs that password. Also served at `POST
    /{feed}`, the short form the client packages and curl one-liners use. A markdown body is at most
    102400 bytes and must be UTF-8. A body that is an image (`image/png`, `image/jpeg`, `image/gif`,
    `image/webp` or `application/octet-stream`) is posted as a note of its own: PNG, JPEG, GIF or WebP,
    recognized by its first bytes, whatever `Content-Type` is sent (SVG is refused). It is stored byte
    for byte, with no resizing and no metadata stripped (EXIF such as GPS position stays in the file),
    at most NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB). The response has its `file` and a `file_url` under
    the feed's read id, public like the read link. `X-Note-Name` gives the picture's original file name.
    A multipart form may send a `file` part instead of `markdown`. `application/x-www-form-urlencoded`
    (what `curl -d` sends) is read as raw markdown, not as form fields. `read_id` (JSON or form field)
    is the feed's read id when this post creates it: random when left out, ignored for a feed that
    exists. Tags (at most 10 tags, each 1 to 32 characters of letters, digits, `-`, `_`, `.` and `:`;
    case is folded to lowercase, duplicates are removed) go in the JSON `tags` array, a repeated `tags`
    form field, or, for a raw body, the `X-Note-Tags` header.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        body (PostJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Created | Error
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
            x_note_tags=x_note_tags,
            x_note_name=x_note_name,
        )
    ).parsed
