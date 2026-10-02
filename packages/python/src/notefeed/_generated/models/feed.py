from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="Feed")


@_attrs_define
class Feed:
    """
    Attributes:
        name (str): The feed's name
        title (str): Display title, at most 100 characters, one line; empty means none (the feed's name is shown)
        description (str): Description, at most 500 characters, one line; may be empty
        protected (bool): Whether the feed has its own password
        read_url (None | str): The feed's read-only RSS link; null while the feed has no notes, or if the server can't
            read the feed's stored read id
        image_url (None | str): The feed's title image (absolute URL, served under the read id), or null
        show_sender (bool): Whether readers see who posted each note
    """

    name: str
    title: str
    description: str
    protected: bool
    read_url: None | str
    image_url: None | str
    show_sender: bool

    def to_dict(self) -> dict[str, Any]:
        name = self.name

        title = self.title

        description = self.description

        protected = self.protected

        read_url: None | str
        read_url = self.read_url

        image_url: None | str
        image_url = self.image_url

        show_sender = self.show_sender

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "name": name,
                "title": title,
                "description": description,
                "protected": protected,
                "read_url": read_url,
                "image_url": image_url,
                "show_sender": show_sender,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        name = d.pop("name")

        title = d.pop("title")

        description = d.pop("description")

        protected = d.pop("protected")

        def _parse_read_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        read_url = _parse_read_url(d.pop("read_url"))

        def _parse_image_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        image_url = _parse_image_url(d.pop("image_url"))

        show_sender = d.pop("show_sender")

        feed = cls(
            name=name,
            title=title,
            description=description,
            protected=protected,
            read_url=read_url,
            image_url=image_url,
            show_sender=show_sender,
        )

        return feed
