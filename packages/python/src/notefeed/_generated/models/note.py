from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="Note")


@_attrs_define
class Note:
    """
    Attributes:
        id (str): UTC time to the second plus a slug of the title
        title (str): The first heading, or the first non-empty line; may be empty
        markdown (str): The note, byte-for-byte as posted
        created_at (datetime.datetime): When the note was posted (UTC)
        url (str): The note's page in the web UI
        sender (None | str | Unset): Verified sign-in name of the poster; absent when the note was posted without a
            sign-in
    """

    id: str
    title: str
    markdown: str
    created_at: datetime.datetime
    url: str
    sender: None | str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        markdown = self.markdown

        created_at = self.created_at.isoformat()

        url = self.url

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
            }
        )
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
            sender=sender,
        )

        return note
