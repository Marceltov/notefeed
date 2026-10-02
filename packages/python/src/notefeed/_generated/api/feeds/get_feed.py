from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed import Feed
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/feeds/{feed}".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | Feed | None:
    if response.status_code == 200:
        response_200 = Feed.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 401:
        response_401 = Error.from_dict(response.json())

        return response_401

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | Feed]:
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
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Get a feed's settings

     The title and description, the title image, whether the feed is protected, and its read link (null
    while it has no notes). A feed exists once its first note is posted.

    Args:
        feed (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
    """

    kwargs = _get_kwargs(
        feed=feed,
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
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Get a feed's settings

     The title and description, the title image, whether the feed is protected, and its read link (null
    while it has no notes). A feed exists once its first note is posted.

    Args:
        feed (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Feed
    """

    return sync_detailed(
        feed=feed,
        client=client,
        x_feed_password=x_feed_password,
    ).parsed


async def asyncio_detailed(
    feed: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Get a feed's settings

     The title and description, the title image, whether the feed is protected, and its read link (null
    while it has no notes). A feed exists once its first note is posted.

    Args:
        feed (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
    """

    kwargs = _get_kwargs(
        feed=feed,
        x_feed_password=x_feed_password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    *,
    client: AuthenticatedClient,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Get a feed's settings

     The title and description, the title image, whether the feed is protected, and its read link (null
    while it has no notes). A feed exists once its first note is posted.

    Args:
        feed (str):
        x_feed_password (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Feed
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            x_feed_password=x_feed_password,
        )
    ).parsed
