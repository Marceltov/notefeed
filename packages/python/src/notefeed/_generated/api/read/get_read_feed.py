from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.read_feed import ReadFeed
from ...types import Response


def _get_kwargs(
    read_id: str,
) -> dict[str, Any]:

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/read/{read_id}".format(
            read_id=quote(str(read_id), safe=""),
        ),
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | ReadFeed | None:
    if response.status_code == 200:
        response_200 = ReadFeed.from_dict(response.json())

        return response_200

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 410:
        response_410 = Error.from_dict(response.json())

        return response_410

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | ReadFeed]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[Error | ReadFeed]:
    """Get a feed's title and description by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    has an empty title and description, so read ids can't be probed; one the operator removed is `410`.

    Args:
        read_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ReadFeed]
    """

    kwargs = _get_kwargs(
        read_id=read_id,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Error | ReadFeed | None:
    """Get a feed's title and description by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    has an empty title and description, so read ids can't be probed; one the operator removed is `410`.

    Args:
        read_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ReadFeed
    """

    return sync_detailed(
        read_id=read_id,
        client=client,
    ).parsed


async def asyncio_detailed(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Response[Error | ReadFeed]:
    """Get a feed's title and description by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    has an empty title and description, so read ids can't be probed; one the operator removed is `410`.

    Args:
        read_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | ReadFeed]
    """

    kwargs = _get_kwargs(
        read_id=read_id,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
) -> Error | ReadFeed | None:
    """Get a feed's title and description by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    has an empty title and description, so read ids can't be probed; one the operator removed is `410`.

    Args:
        read_id (str):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | ReadFeed
    """

    return (
        await asyncio_detailed(
            read_id=read_id,
            client=client,
        )
    ).parsed
