from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadFeed")


@_attrs_define
class ReadFeed:
    """
    Attributes:
        title (str): Display title, at most 100 characters, one line; empty means none (the feed's name is shown)
        description (str): Description, at most 500 characters, one line; may be empty
    """

    title: str
    description: str

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "title": title,
                "description": description,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title")

        description = d.pop("description")

        read_feed = cls(
            title=title,
            description=description,
        )

        return read_feed
