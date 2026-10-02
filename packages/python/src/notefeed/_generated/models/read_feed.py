from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="ReadFeed")


@_attrs_define
class ReadFeed:
    """
    Attributes:
        title (str): Display title, at most 100 characters, one line; empty means none (the feed's name is shown)
        description (str): Description, at most 500 characters, one line; may be empty
        image_url (None | str): The feed's title image (absolute URL, served under the read id), or null
    """

    title: str
    description: str
    image_url: None | str

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        image_url: None | str
        image_url = self.image_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "title": title,
                "description": description,
                "image_url": image_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title")

        description = d.pop("description")

        def _parse_image_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image_url = _parse_image_url(d.pop("image_url"))

        read_feed = cls(
            title=title,
            description=description,
            image_url=image_url,
        )

        return read_feed
