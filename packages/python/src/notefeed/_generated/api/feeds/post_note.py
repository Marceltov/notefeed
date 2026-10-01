from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.created import Created
from ...models.error import Error
from ...models.post_json import PostJson
from ...types import Response


def _get_kwargs(
    feed: str,
    *,
    body: PostJson,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}

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
) -> Response[Any | Created | Error]:
    """Post a note

     Creates the feed with its first note. Also served at `POST /{feed}`, the short form the client
    packages and curl one-liners use. The body is at most 102400 bytes and must be UTF-8.
    `application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form
    fields.

    Args:
        feed (str):
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
) -> Any | Created | Error | None:
    """Post a note

     Creates the feed with its first note. Also served at `POST /{feed}`, the short form the client
    packages and curl one-liners use. The body is at most 102400 bytes and must be UTF-8.
    `application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form
    fields.

    Args:
        feed (str):
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
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
) -> Response[Any | Created | Error]:
    """Post a note

     Creates the feed with its first note. Also served at `POST /{feed}`, the short form the client
    packages and curl one-liners use. The body is at most 102400 bytes and must be UTF-8.
    `application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form
    fields.

    Args:
        feed (str):
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
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    body: PostJson,
) -> Any | Created | Error | None:
    """Post a note

     Creates the feed with its first note. Also served at `POST /{feed}`, the short form the client
    packages and curl one-liners use. The body is at most 102400 bytes and must be UTF-8.
    `application/x-www-form-urlencoded` (what `curl -d` sends) is read as raw markdown, not as form
    fields.

    Args:
        feed (str):
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
        )
    ).parsed
