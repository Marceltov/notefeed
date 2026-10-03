from http import HTTPStatus
from typing import Any
from urllib.parse import quote

import httpx

from ... import errors
from ...client import AuthenticatedClient, Client
from ...models.error import Error
from ...models.note_edited import NoteEdited
from ...types import UNSET, File, Response, Unset


def _get_kwargs(
    feed: str,
    id: str,
    *,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    if not isinstance(x_feed_password, Unset):
        headers["X-Feed-Password"] = x_feed_password

    if not isinstance(x_note_tags, Unset):
        headers["X-Note-Tags"] = x_note_tags

    _kwargs: dict[str, Any] = {
        "method": "put",
        "url": "/api/v1/feeds/{feed}/notes/{id}".format(
            feed=quote(str(feed), safe=""),
            id=quote(str(id), safe=""),
        ),
    }

    _kwargs["content"] = body.payload
    headers["Content-Type"] = "application/octet-stream"

    _kwargs["headers"] = headers
    return _kwargs


def _parse_response(
    *, client: AuthenticatedClient | Client, response: httpx.Response
) -> Error | NoteEdited | None:
    if response.status_code == 200:
        response_200 = NoteEdited.from_dict(response.json())

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
) -> Response[Error | NoteEdited]:
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
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
) -> Response[Error | NoteEdited]:
    """Replace a note's content

     The body is the new file, with the same rules as posting: a `Content-Type` that is one of the
    accepted types, a body that is what it declares. A note keeps its type, so the type must be the
    note's own (`415` otherwise). Id, creation time and metadata stay: the title of a markdown note
    without one set follows the new text. Change the title or alt text with `PATCH`. Needs the feed's
    password if it has one, and counts against the post rate limit. Read links can't edit. A markdown
    note with its pictures is one `multipart/form-data` request: a `text` part (the markdown), `file`
    parts (up to 10 pictures, each with its file name and image `Content-Type`) and `alt.<file name>`
    fields. The pictures are stored first, each as its own note named by its file name, then the text
    with its references to them (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded)
    swapped for the stored files; a picture it never refers to is appended as `![](file)`. Everything is
    checked before the first write, and a failed write removes what the request stored: all or nothing.
    `X-Note-Alt` and `X-Note-Name` are 400. The answer has `attachments`, the stored pictures in the
    order of the `file` parts. On a `PUT` the `text` part is required and the note must be a markdown
    note; the note keeps its own title and tags, `X-Note-Tags` goes on the new pictures.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NoteEdited]
    """

    kwargs = _get_kwargs(
        feed=feed,
        id=id,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
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
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
) -> Error | NoteEdited | None:
    """Replace a note's content

     The body is the new file, with the same rules as posting: a `Content-Type` that is one of the
    accepted types, a body that is what it declares. A note keeps its type, so the type must be the
    note's own (`415` otherwise). Id, creation time and metadata stay: the title of a markdown note
    without one set follows the new text. Change the title or alt text with `PATCH`. Needs the feed's
    password if it has one, and counts against the post rate limit. Read links can't edit. A markdown
    note with its pictures is one `multipart/form-data` request: a `text` part (the markdown), `file`
    parts (up to 10 pictures, each with its file name and image `Content-Type`) and `alt.<file name>`
    fields. The pictures are stored first, each as its own note named by its file name, then the text
    with its references to them (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded)
    swapped for the stored files; a picture it never refers to is appended as `![](file)`. Everything is
    checked before the first write, and a failed write removes what the request stored: all or nothing.
    `X-Note-Alt` and `X-Note-Name` are 400. The answer has `attachments`, the stored pictures in the
    order of the `file` parts. On a `PUT` the `text` part is required and the note must be a markdown
    note; the note keeps its own title and tags, `X-Note-Tags` goes on the new pictures.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NoteEdited
    """

    return sync_detailed(
        feed=feed,
        id=id,
        client=client,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
    ).parsed


async def asyncio_detailed(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
) -> Response[Error | NoteEdited]:
    """Replace a note's content

     The body is the new file, with the same rules as posting: a `Content-Type` that is one of the
    accepted types, a body that is what it declares. A note keeps its type, so the type must be the
    note's own (`415` otherwise). Id, creation time and metadata stay: the title of a markdown note
    without one set follows the new text. Change the title or alt text with `PATCH`. Needs the feed's
    password if it has one, and counts against the post rate limit. Read links can't edit. A markdown
    note with its pictures is one `multipart/form-data` request: a `text` part (the markdown), `file`
    parts (up to 10 pictures, each with its file name and image `Content-Type`) and `alt.<file name>`
    fields. The pictures are stored first, each as its own note named by its file name, then the text
    with its references to them (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded)
    swapped for the stored files; a picture it never refers to is appended as `![](file)`. Everything is
    checked before the first write, and a failed write removes what the request stored: all or nothing.
    `X-Note-Alt` and `X-Note-Name` are 400. The answer has `attachments`, the stored pictures in the
    order of the `file` parts. On a `PUT` the `text` part is required and the note must be a markdown
    note; the note keeps its own title and tags, `X-Note-Tags` goes on the new pictures.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Response[Error | NoteEdited]
    """

    kwargs = _get_kwargs(
        feed=feed,
        id=id,
        body=body,
        x_feed_password=x_feed_password,
        x_note_tags=x_note_tags,
    )

    response = await client.get_async_httpx_client().request(**kwargs)

    return _build_response(client=client, response=response)


async def asyncio(
    feed: str,
    id: str,
    *,
    client: AuthenticatedClient,
    body: File,
    x_feed_password: str | Unset = UNSET,
    x_note_tags: str | Unset = UNSET,
) -> Error | NoteEdited | None:
    """Replace a note's content

     The body is the new file, with the same rules as posting: a `Content-Type` that is one of the
    accepted types, a body that is what it declares. A note keeps its type, so the type must be the
    note's own (`415` otherwise). Id, creation time and metadata stay: the title of a markdown note
    without one set follows the new text. Change the title or alt text with `PATCH`. Needs the feed's
    password if it has one, and counts against the post rate limit. Read links can't edit. A markdown
    note with its pictures is one `multipart/form-data` request: a `text` part (the markdown), `file`
    parts (up to 10 pictures, each with its file name and image `Content-Type`) and `alt.<file name>`
    fields. The pictures are stored first, each as its own note named by its file name, then the text
    with its references to them (`![](chart.png)`, `[x]: chart.png`, as written or percent-decoded)
    swapped for the stored files; a picture it never refers to is appended as `![](file)`. Everything is
    checked before the first write, and a failed write removes what the request stored: all or nothing.
    `X-Note-Alt` and `X-Note-Name` are 400. The answer has `attachments`, the stored pictures in the
    order of the `file` parts. On a `PUT` the `text` part is required and the note must be a markdown
    note; the note keeps its own title and tags, `X-Note-Tags` goes on the new pictures.

    Args:
        feed (str):
        id (str):
        x_feed_password (str | Unset):
        x_note_tags (str | Unset):
        body (File): The note, a file: its bytes, of the type `Content-Type` declares

    Raises:
        errors.UnexpectedStatus: If the server returns an undocumented status code and Client.raise_on_unexpected_status is True.
        httpx.TimeoutException: If the request takes longer than Client.timeout.

    Returns:
        Error | NoteEdited
    """

    return (
        await asyncio_detailed(
            feed=feed,
            id=id,
            client=client,
            body=body,
            x_feed_password=x_feed_password,
            x_note_tags=x_note_tags,
        )
    ).parsed
