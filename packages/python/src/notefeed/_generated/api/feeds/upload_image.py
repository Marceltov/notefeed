from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.image_uploaded import ImageUploaded
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

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
) -> Error | ImageUploaded | None:
    if response.status_code == 201:
        response_201 = ImageUploaded.from_dict(response.json())

        return response_201

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

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
) -> Response[Error | ImageUploaded]:
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
) -> Response[Error | ImageUploaded]:
    """Upload an image

     The body is the image itself: PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte-for-byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file), as the first 32 hex characters of its
    SHA-256 plus an extension: the same bytes always give the same URL. The URL is under the feed's read
    id, so it works in the feed page, the read-only view and RSS readers without any password. Needs the
    same credentials as posting and counts against the post rate limit. The feed must exist: it is
    created by its first note. The size limit is NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB); images
    deleted only with the feed.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ImageUploaded]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
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
) -> Error | ImageUploaded | None:
    """Upload an image

     The body is the image itself: PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte-for-byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file), as the first 32 hex characters of its
    SHA-256 plus an extension: the same bytes always give the same URL. The URL is under the feed's read
    id, so it works in the feed page, the read-only view and RSS readers without any password. Needs the
    same credentials as posting and counts against the post rate limit. The feed must exist: it is
    created by its first note. The size limit is NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB); images
    deleted only with the feed.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ImageUploaded
    """

    return sync_detailed(
        feed=feed,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | ImageUploaded]:
    """Upload an image

     The body is the image itself: PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte-for-byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file), as the first 32 hex characters of its
    SHA-256 plus an extension: the same bytes always give the same URL. The URL is under the feed's read
    id, so it works in the feed page, the read-only view and RSS readers without any password. Needs the
    same credentials as posting and counts against the post rate limit. The feed must exist: it is
    created by its first note. The size limit is NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB); images
    deleted only with the feed.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ImageUploaded]
    """

    kwargs = _get_kwargs(
        feed=feed,
        body=body,
        x_feed_password=x_feed_password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
) -> Error | ImageUploaded | None:
    """Upload an image

     The body is the image itself: PNG, JPEG, GIF or WebP, recognized by its first bytes, whatever
    `Content-Type` is sent (SVG is refused). Stored byte-for-byte, with no resizing and no metadata
    stripped (EXIF such as GPS position stays in the file), as the first 32 hex characters of its
    SHA-256 plus an extension: the same bytes always give the same URL. The URL is under the feed's read
    id, so it works in the feed page, the read-only view and RSS readers without any password. Needs the
    same credentials as posting and counts against the post rate limit. The feed must exist: it is
    created by its first note. The size limit is NOTEFEED_MAX_IMAGE_BYTES (default 5 MiB); images
    deleted only with the feed.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (File): The image's bytes: PNG, JPEG, GIF or WebP, recognized by their first bytes,
            not by the Content-Type

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ImageUploaded
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
        )
    ).parsed
