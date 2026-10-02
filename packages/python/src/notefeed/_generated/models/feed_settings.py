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
        show_sender (bool | Unset): Whether readers (RSS, the read API and pages) see who posted each note; omitted
            leaves it as it is, a new feed starts with true
        name (str | Unset): A new name for the feed (a-z, 0-9, - and _, at most 64 characters), which is also its write
            key. Everything stays, the old name stops working (404, for good) and browsers unlocked with the password are
            signed out. Omitted leaves it as it is; reserved feeds can't be renamed
        read_id (str | Unset): A new read id (3 to 64 characters: a-z, 0-9, - and _), empty for a random one. The old
            read link stops working (404, for good), and so do image URLs in notes that contain it. Omitted leaves it as it
            is; reserved feeds keep theirs
    """

    title: str
    description: str
    image: str | Unset = UNSET
    show_sender: bool | Unset = UNSET
    name: str | Unset = UNSET
    read_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        title = self.title

        description = self.description

        image = self.image

        show_sender = self.show_sender

        name = self.name

        read_id = self.read_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "title": title,
                "description": description,
            }
        )
        if image is not UNSET:
            field_dict["image"] = image
        if show_sender is not UNSET:
            field_dict["show_sender"] = show_sender
        if name is not UNSET:
            field_dict["name"] = name
        if read_id is not UNSET:
            field_dict["read_id"] = read_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        title = d.pop("title")

        description = d.pop("description")

        image = d.pop("image", UNSET)

        show_sender = d.pop("show_sender", UNSET)

        name = d.pop("name", UNSET)

        read_id = d.pop("read_id", UNSET)

        feed_settings = cls(
            title=title,
            description=description,
            image=image,
            show_sender=show_sender,
            name=name,
            read_id=read_id,
        )

        return feed_settings
