from http import HTTPStatus
from typing import Any, cast
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.password_json import PasswordJson
from ...types import UNSET, Response, Unset


def _get_kwargs(
    feed: str,
    *,
    body: PasswordJson,
    x_feed_password: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/feeds/{feed}/password".format(
            feed=quote(str(feed), safe=""),
        ),
    }

    _kwargs["json"] = body.to_dict()

    headers["Content-Type"] = "application/json"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Any | Error | None:
    if response.status_code == 204:
        response_204 = cast(Any, None)
        return response_204

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
) -> Response[Any | Error]:
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
    body: PasswordJson,
    x_feed_password: str | Unset = UNSET,
) -> Response[Any | Error]:
    """Change a feed's password

     Needs the current password in `X-Feed-Password`. A feed can only get a password when it is created,
    so an open feed answers 409.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (PasswordJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Error]
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
    body: PasswordJson,
    x_feed_password: str | Unset = UNSET,
) -> Any | Error | None:
    """Change a feed's password

     Needs the current password in `X-Feed-Password`. A feed can only get a password when it is created,
    so an open feed answers 409.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (PasswordJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Error
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
    body: PasswordJson,
    x_feed_password: str | Unset = UNSET,
) -> Response[Any | Error]:
    """Change a feed's password

     Needs the current password in `X-Feed-Password`. A feed can only get a password when it is created,
    so an open feed answers 409.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (PasswordJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Any | Error]
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
    body: PasswordJson,
    x_feed_password: str | Unset = UNSET,
) -> Any | Error | None:
    """Change a feed's password

     Needs the current password in `X-Feed-Password`. A feed can only get a password when it is created,
    so an open feed answers 409.

    Args:
        feed (str):
        x_feed_password (str | Unset):
        body (PasswordJson):

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Any | Error
    """

    return (
        await asyncio_detailed(
            feed=feed,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
        )
    ).parsed
