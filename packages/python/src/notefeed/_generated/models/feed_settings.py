from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="FeedSettings")


@_attrs_define
class FeedSettings:
    """
    Attributes:
        title (str): Display title, at most 100 characters, one line; empty means none (the feed's name is shown)
        description (str): Description, at most 500 characters, one line; may be empty
        image (str | Unset): The file name of an image uploaded to this feed (see uploadImage), shown as the feed's
            title image; empty removes it, omitted leaves it as it is
    """

    title: str
    description: str
    image: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        image = self.image

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "title": title,
                "description": description,
            }
        )
        if image is not UNSET:
            field_dict["image"] = image

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title")

        description = d.pop("description")

        image = d.pop("image", UNSET)

        feed_settings = cls(
            title=title,
            description=description,
            image=image,
        )

        return feed_settings
