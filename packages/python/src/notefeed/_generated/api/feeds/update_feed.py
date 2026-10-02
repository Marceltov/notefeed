from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.feed import Feed
from ...models.feed_settings import FeedSettings
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: FeedSettings,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/feeds/{feed}".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

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

    if response.status_code == 409:
        response_409 = Error.from_dict(response.json())

        return response_409

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
    body: FeedSettings,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Change a feed's settings

     Replaces both the title (at most 100 characters) and the description (at most 500); surrounding
    whitespace is trimmed and control characters are refused. `show_sender` (default true) shows who
    posted each note to readers; omitted leaves it as it is. `image` is the file name `uploadImage`
    returned for this feed (title image), empty to remove it, or omitted to leave it as it is; any other
    value is a 400. `name` renames the feed and `read_id` gives it another read link (empty for a random
    one); the old name and the old read id are retired and answer 404 from then on, and the response is
    the feed under its new name. Both are capabilities on an open feed, so a short readable one is
    guessable: protect the feed with a password if that matters. An instance can turn chosen names and
    read ids off (NOTEFEED_ALLOW_CUSTOM_IDS=0): then only an empty `read_id` is accepted. Needs the
    feed's password if it has one, and counts against the post rate limit. Only on a feed that exists:
    it is created by its first note. Read links can't change settings.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (FeedSettings):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
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
    body: FeedSettings,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Change a feed's settings

     Replaces both the title (at most 100 characters) and the description (at most 500); surrounding
    whitespace is trimmed and control characters are refused. `show_sender` (default true) shows who
    posted each note to readers; omitted leaves it as it is. `image` is the file name `uploadImage`
    returned for this feed (title image), empty to remove it, or omitted to leave it as it is; any other
    value is a 400. `name` renames the feed and `read_id` gives it another read link (empty for a random
    one); the old name and the old read id are retired and answer 404 from then on, and the response is
    the feed under its new name. Both are capabilities on an open feed, so a short readable one is
    guessable: protect the feed with a password if that matters. An instance can turn chosen names and
    read ids off (NOTEFEED_ALLOW_CUSTOM_IDS=0): then only an empty `read_id` is accepted. Needs the
    feed's password if it has one, and counts against the post rate limit. Only on a feed that exists:
    it is created by its first note. Read links can't change settings.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (FeedSettings):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Feed
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
    body: FeedSettings,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Feed]:
    """Change a feed's settings

     Replaces both the title (at most 100 characters) and the description (at most 500); surrounding
    whitespace is trimmed and control characters are refused. `show_sender` (default true) shows who
    posted each note to readers; omitted leaves it as it is. `image` is the file name `uploadImage`
    returned for this feed (title image), empty to remove it, or omitted to leave it as it is; any other
    value is a 400. `name` renames the feed and `read_id` gives it another read link (empty for a random
    one); the old name and the old read id are retired and answer 404 from then on, and the response is
    the feed under its new name. Both are capabilities on an open feed, so a short readable one is
    guessable: protect the feed with a password if that matters. An instance can turn chosen names and
    read ids off (NOTEFEED_ALLOW_CUSTOM_IDS=0): then only an empty `read_id` is accepted. Needs the
    feed's password if it has one, and counts against the post rate limit. Only on a feed that exists:
    it is created by its first note. Read links can't change settings.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (FeedSettings):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Feed]
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
    body: FeedSettings,
    x_feed_password: str | Unset = UNSET,
) -> Error | Feed | None:
    """Change a feed's settings

     Replaces both the title (at most 100 characters) and the description (at most 500); surrounding
    whitespace is trimmed and control characters are refused. `show_sender` (default true) shows who
    posted each note to readers; omitted leaves it as it is. `image` is the file name `uploadImage`
    returned for this feed (title image), empty to remove it, or omitted to leave it as it is; any other
    value is a 400. `name` renames the feed and `read_id` gives it another read link (empty for a random
    one); the old name and the old read id are retired and answer 404 from then on, and the response is
    the feed under its new name. Both are capabilities on an open feed, so a short readable one is
    guessable: protect the feed with a password if that matters. An instance can turn chosen names and
    read ids off (NOTEFEED_ALLOW_CUSTOM_IDS=0): then only an empty `read_id` is accepted. Needs the
    feed's password if it has one, and counts against the post rate limit. Only on a feed that exists:
    it is created by its first note. Read links can't change settings.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (FeedSettings):

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
            body=body,
            x_feed_password=x_feed_password,
        )
    ).parsed
