from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

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
    """

    id: str
    title: str
    markdown: str
    created_at: datetime.datetime
    url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        title = self.title

        markdown = self.markdown

        created_at = self.created_at.isoformat()

        url = self.url

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

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        title = d.pop("title")

        markdown = d.pop("markdown")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        url = d.pop("url")

        note = cls(
            id=id,
            title=title,
            markdown=markdown,
            created_at=created_at,
            url=url,
        )

        return note
