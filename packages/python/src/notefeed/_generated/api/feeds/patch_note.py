from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.note import Note
from ...models.note_meta import NoteMeta
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    id: str,
    *,
    body: NoteMeta,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "patch",
        "url": "/api/v1/feeds/{feed}/notes/{id}".format(
            feed=quote(str(feed), safe=""),
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | Note | None:
    if response.status_code == 200:
        response_200 = Note.from_dict(response.json())

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

    if response.status_code == 415:
        response_415 = Error.from_dict(response.json())

        return response_415

    if response.status_code == 429:
        response_429 = Error.from_dict(response.json())

        return response_429

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | Note]:
    return Response(
        status_code=HTTPStatus(response.status_code),
        content=response.content,
        headers=response.headers,
        parsed=_parse_response(client=client, response=response),
    )


def sync_detailed(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: NoteMeta,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Note]:
    """Change a note's title or alt text

     Sets the note's title and/or alt text (alt only for images). An empty string removes one: a markdown
    note's title follows its text again. At least one is needed. Needs the feed's password if it has
    one, and counts against the post rate limit. Read links can't change notes.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        body (NoteMeta):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Note]
    """

    kwargs = _get_kwargs(
        feed=feed,
        id=id,
        body=body,
        x_feed_password=x_feed_password,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: NoteMeta,
    x_feed_password: str | Unset = UNSET,
) -> Error | Note | None:
    """Change a note's title or alt text

     Sets the note's title and/or alt text (alt only for images). An empty string removes one: a markdown
    note's title follows its text again. At least one is needed. Needs the feed's password if it has
    one, and counts against the post rate limit. Read links can't change notes.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        body (NoteMeta):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Note
    """

    return sync_detailed(
        feed=feed,
        id=id,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
    ).parsed


async def asyncio_detailed(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: NoteMeta,
    x_feed_password: str | Unset = UNSET,
) -> Response[Error | Note]:
    """Change a note's title or alt text

     Sets the note's title and/or alt text (alt only for images). An empty string removes one: a markdown
    note's title follows its text again. At least one is needed. Needs the feed's password if it has
    one, and counts against the post rate limit. Read links can't change notes.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        body (NoteMeta):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | Note]
    """

    kwargs = _get_kwargs(
        feed=feed,
        id=id,
        body=body,
        x_feed_password=x_feed_password,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: NoteMeta,
    x_feed_password: str | Unset = UNSET,
) -> Error | Note | None:
    """Change a note's title or alt text

     Sets the note's title and/or alt text (alt only for images). An empty string removes one: a markdown
    note's title follows its text again. At least one is needed. Needs the feed's password if it has
    one, and counts against the post rate limit. Read links can't change notes.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        body (NoteMeta):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | Note
    """

    return (
        await asyncio_detailed(
            feed=feed,
            id=id,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
        )
    ).parsed
