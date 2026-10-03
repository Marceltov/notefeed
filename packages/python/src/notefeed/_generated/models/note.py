from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..models.note_kind import NoteKind
from ..types import UNSET, Unset

T = TypeVar("T", bound="Note")


@_attrs_define
class Note:
    """
    Attributes:
        id (str): The note's id: a UTC time to the second plus a random UUID for notes made here; any name without a dot
            for a file placed by hand
        title (str): The title set for the note, else the first heading or the first non-empty line of a markdown note;
            may be empty (an image without one)
        markdown (str): The note, byte-for-byte as posted
        created_at (datetime.datetime): When the note was posted (UTC)
        url (str): The note's page in the web UI
        tags (list[str]): Labels the poster gave the note (not verified, and shown to readers like the note itself);
            empty when none
        kind (NoteKind | Unset): What the note is: a markdown text, or a picture (then `markdown` is empty and the
            picture is the file `file`). Always sent; optional here so a client still reads an older server's notes, which
            have only markdown
        file (str | Unset): The note's file name, `<id>.<extension>`; served under the feed's read id, like the picture
            of an image note. Always sent; optional here for older servers
        alt (None | str | Unset): Alternative text of an image note
        name (None | str | Unset): The file name an image was posted with
        size (int | Unset): The size of the note's content in bytes. Always sent; optional here for older servers
        file_url (None | str | Unset): Where the note's file is served, absolute, under the feed's read id; null while
            the feed has no read link
        sender (None | str | Unset): Verified sign-in name of the poster; absent when the note was posted without a
            sign-in
    """

    id: str
    title: str
    markdown: str
    created_at: datetime.datetime
    url: str
    tags: list[str]
    kind: NoteKind | Unset = UNSET
    file: str | Unset = UNSET
    alt: None | str | Unset = UNSET
    name: None | str | Unset = UNSET
    size: int | Unset = UNSET
    file_url: None | str | Unset = UNSET
    sender: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        markdown = self.markdown

        created_at = self.created_at.isoformat()

        url = self.url

        tags = self.tags

        kind: str | Unset = UNSET
        if not isinstance(self.kind, Unset):
            kind = self.kind.value

        file = self.file

        alt: None | str | Unset
        if isinstance(self.alt, Unset):
            alt = UNSET
        else:
            alt = self.alt

        name: None | str | Unset
        if isinstance(self.name, Unset):
            name = UNSET
        else:
            name = self.name

        size = self.size

        file_url: None | str | Unset
        if isinstance(self.file_url, Unset):
            file_url = UNSET
        else:
            file_url = self.file_url

        sender: None | str | Unset
        if isinstance(self.sender, Unset):
            sender = UNSET
        else:
            sender = self.sender

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "title": title,
                "markdown": markdown,
                "created_at": created_at,
                "url": url,
                "tags": tags,
            }
        )
        if kind is not UNSET:
            field_dict["kind"] = kind
        if file is not UNSET:
            field_dict["file"] = file
        if alt is not UNSET:
            field_dict["alt"] = alt
        if name is not UNSET:
            field_dict["name"] = name
        if size is not UNSET:
            field_dict["size"] = size
        if file_url is not UNSET:
            field_dict["file_url"] = file_url
        if sender is not UNSET:
            field_dict["sender"] = sender

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        markdown = d.pop("markdown")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        url = d.pop("url")

        tags = cast(list[str], d.pop("tags"))

        _kind = d.pop("kind", UNSET)
        kind: NoteKind | Unset
        if isinstance(_kind, Unset):
            kind = UNSET
        else:
            kind = NoteKind(_kind)

        file = d.pop("file", UNSET)

        def _parse_alt(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        alt = _parse_alt(d.pop("alt", UNSET))

        def _parse_name(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        name = _parse_name(d.pop("name", UNSET))

        size = d.pop("size", UNSET)

        def _parse_file_url(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        file_url = _parse_file_url(d.pop("file_url", UNSET))

        def _parse_sender(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sender = _parse_sender(d.pop("sender", UNSET))

        note = cls(
            id=id,
            title=title,
            markdown=markdown,
            created_at=created_at,
            url=url,
            tags=tags,
            kind=kind,
            file=file,
            alt=alt,
            name=name,
            size=size,
            file_url=file_url,
            sender=sender,
        )

        return note
