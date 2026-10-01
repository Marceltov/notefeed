from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="Created")


@_attrs_define
class Created:
    """
    Attributes:
        id (str):
        url (str): The note's page in the web UI
        feed_url (str): The feed's page in the web UI
        read_url (str): The feed's read-only RSS link, safe to share
    """

    id: str
    url: str
    feed_url: str
    read_url: str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        url = self.url

        feed_url = self.feed_url

        read_url = self.read_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "url": url,
                "feed_url": feed_url,
                "read_url": read_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        url = d.pop("url")

        feed_url = d.pop("feed_url")

        read_url = d.pop("read_url")

        created = cls(
            id=id,
            url=url,
            feed_url=feed_url,
            read_url=read_url,
        )

        return created
