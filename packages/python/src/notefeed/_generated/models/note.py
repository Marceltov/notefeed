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
        kind (NoteKind): What the note is: a markdown text, or a picture (then `markdown` is empty and the picture is
            the file `file`)
        file (str): The note's file name, `<id>.<extension>`; served under the feed's read id, like the picture of an
            image note
        id (str): The note's id: a UTC time to the second plus a random UUID for notes made here; any name without a dot
            for a file placed by hand
        title (str): The first heading, or the first non-empty line; may be empty
        markdown (str): The note, byte-for-byte as posted
        created_at (datetime.datetime): When the note was posted (UTC)
        url (str): The note's page in the web UI
        tags (list[str]): Labels the poster gave the note (not verified, and shown to readers like the note itself);
            empty when none
        sender (None | str | Unset): Verified sign-in name of the poster; absent when the note was posted without a
            sign-in
    """

    kind: NoteKind
    file: str
    id: str
    title: str
    markdown: str
    created_at: datetime.datetime
    url: str
    tags: list[str]
    sender: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        kind = self.kind.value

        file = self.file

        id = self.id

        title = self.title

        markdown = self.markdown

        created_at = self.created_at.isoformat()

        url = self.url

        tags = self.tags

        sender: None | str | Unset
        if isinstance(self.sender, Unset):
            sender = UNSET
        else:
            sender = self.sender

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "kind": kind,
                "file": file,
                "id": id,
                "title": title,
                "markdown": markdown,
                "created_at": created_at,
                "url": url,
                "tags": tags,
            }
        )
        if sender is not UNSET:
            field_dict["sender"] = sender

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        kind = NoteKind(d.pop("kind"))

        file = d.pop("file")

        id = d.pop("id")

        title = d.pop("title")

        markdown = d.pop("markdown")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        url = d.pop("url")

        tags = cast(list[str], d.pop("tags"))

        def _parse_sender(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sender = _parse_sender(d.pop("sender", UNSET))

        note = cls(
            kind=kind,
            file=file,
            id=id,
            title=title,
            markdown=markdown,
            created_at=created_at,
            url=url,
            tags=tags,
            sender=sender,
        )

        return note
