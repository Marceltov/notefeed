from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.note_list import NoteList
from ...types import UNSET, Response, Unset


def _get_kwargs(
    read_id: str,
    *,
    limit: int | Unset = 50,
    before: str | Unset = UNSET,
) -> dict[str, Any]:

    params: dict[str, Any] = {}

    params["limit"] = limit

    params["before"] = before

    params = {k: v for k, v in params.items() if v is not UNSET and v is not None}

    _kwargs: dict[str, Any] = {
        "method": "get",
        "url": "/api/v1/read/{read_id}/notes".format(
            read_id=quote(str(read_id), safe=""),
        ),
        "params": params,
    }

    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | NoteList | None:
    if response.status_code == 200:
        response_200 = NoteList.from_dict(response.json())

        return response_200

    if response.status_code == 400:
        response_400 = Error.from_dict(response.json())

        return response_400

    if response.status_code == 404:
        response_404 = Error.from_dict(response.json())

        return response_404

    if client.raise_on_unexpected_status:
        raise errors.UnexpectedStatus(response.status_code, response.content)
    else:
        return None


def _build_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Response[Error | NoteList]:
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
    limit: int | Unset = 50,
    before: str | Unset = UNSET,
) -> Response[Error | NoteList]:
    """List a feed's notes by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    is an empty list, so read ids can't be probed. The same notes as the read link's RSS.

    Args:
        read_id (str):
        limit (int | Unset):  Default: 50.
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NoteList]
    """

    kwargs = _get_kwargs(
        read_id=read_id,
        limit=limit,
        before=before,
    )

    response = client.get_httpx_client().request(
        **kwargs,
    )

    return _build_response(client=client, response=response)


def sync(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    before: str | Unset = UNSET,
) -> Error | NoteList | None:
    """List a feed's notes by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    is an empty list, so read ids can't be probed. The same notes as the read link's RSS.

    Args:
        read_id (str):
        limit (int | Unset):  Default: 50.
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NoteList
    """

    return sync_detailed(
        read_id=read_id,
        client=client,
        limit=limit,
        before=before,
    ).parsed


async def asyncio_detailed(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    before: str | Unset = UNSET,
) -> Response[Error | NoteList]:
    """List a feed's notes by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    is an empty list, so read ids can't be probed. The same notes as the read link's RSS.

    Args:
        read_id (str):
        limit (int | Unset):  Default: 50.
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NoteList]
    """

    kwargs = _get_kwargs(
        read_id=read_id,
        limit=limit,
        before=before,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    read_id: str,
    *,
    client: AuthenticatedClient | Client,
    limit: int | Unset = 50,
    before: str | Unset = UNSET,
) -> Error | NoteList | None:
    """List a feed's notes by its read id

     Public, even on an instance with a password, and never reveals the feed's name. An unknown read id
    is an empty list, so read ids can't be probed. The same notes as the read link's RSS.

    Args:
        read_id (str):
        limit (int | Unset):  Default: 50.
        before (str | Unset):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NoteList
    """

    return (
        await asyncio_detailed(
            read_id=read_id,
            client=client,
            limit=limit,
            before=before,
        )
    ).parsed
