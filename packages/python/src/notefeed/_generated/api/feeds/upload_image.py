from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.created import Created
from ...models.error import Error
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    if not isinstance(x_note_tags, Unset):
        headers["X-Note-Tags"] = x_note_tags

    if not isinstance(x_note_name, Unset):
        headers["X-Note-Name"] = x_note_name

    if not isinstance(x_note_title, Unset):
        headers["X-Note-Title"] = x_note_title

    if not isinstance(x_note_alt, Unset):
        headers["X-Note-Alt"] = x_note_alt

    _kwargs: dict[str, Any] = {
        "method": "post",
        "url": "/api/v1/feeds/{feed}/images".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

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
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
) -> Response[Any | Created | Error]:
    """Post an image

     The same as posting a note with an image body, for clients that send the picture itself: it becomes
    a note of its own. The body is PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte for byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file). The response has the note's `file` and a
    `file_url` under the feed's read link, public like the read link, and `![](file)` in a markdown note
    shows it. Creates the feed if it does not exist, like a first note; a password given then protects
    it. Needs the same credentials as posting and counts against the post rate limit. The size limit is
    NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB).

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        x_note_title (str | Unset):
        x_note_alt (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

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
        x_note_title=x_note_title,
        x_note_alt=x_note_alt,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
) -> Any | Created | Error | None:
    """Post an image

     The same as posting a note with an image body, for clients that send the picture itself: it becomes
    a note of its own. The body is PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte for byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file). The response has the note's `file` and a
    `file_url` under the feed's read link, public like the read link, and `![](file)` in a markdown note
    shows it. Creates the feed if it does not exist, like a first note; a password given then protects
    it. Needs the same credentials as posting and counts against the post rate limit. The size limit is
    NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB).

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        x_note_title (str | Unset):
        x_note_alt (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

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
        x_note_title=x_note_title,
        x_note_alt=x_note_alt,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
) -> Response[Any | Created | Error]:
    """Post an image

     The same as posting a note with an image body, for clients that send the picture itself: it becomes
    a note of its own. The body is PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte for byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file). The response has the note's `file` and a
    `file_url` under the feed's read link, public like the read link, and `![](file)` in a markdown note
    shows it. Creates the feed if it does not exist, like a first note; a password given then protects
    it. Needs the same credentials as posting and counts against the post rate limit. The size limit is
    NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB).

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        x_note_title (str | Unset):
        x_note_alt (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

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
        x_note_title=x_note_title,
        x_note_alt=x_note_alt,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
    x_note_name: str | Unset = UNSET,
    x_note_title: str | Unset = UNSET,
    x_note_alt: str | Unset = UNSET,
) -> Any | Created | Error | None:
    """Post an image

     The same as posting a note with an image body, for clients that send the picture itself: it becomes
    a note of its own. The body is PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte for byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file). The response has the note's `file` and a
    `file_url` under the feed's read link, public like the read link, and `![](file)` in a markdown note
    shows it. Creates the feed if it does not exist, like a first note; a password given then protects
    it. Needs the same credentials as posting and counts against the post rate limit. The size limit is
    NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB).

    Args:
        feed (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        x_note_name (str | Unset):
        x_note_title (str | Unset):
        x_note_alt (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

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
            x_note_title=x_note_title,
            x_note_alt=x_note_alt,
        )
    ).parsed
