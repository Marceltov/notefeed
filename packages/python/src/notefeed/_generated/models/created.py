from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

T = TypeVar("T", bound="Created")


@_attrs_define
class Created:
    """
    Attributes:
        id (str):
        url (str): The note's page in the web UI
        feed_url (str): The feed's page in the web UI
        read_url (None | str): The feed's read-only RSS link, safe to share; null only if the server can't read the
            feed's stored read id, or if that id and the derived one both belong to other feeds
        file (str): The note's file name, `<id>.<extension>`. For an image note, pass it as a feed's `image` setting
        file_url (None | str): Where the note's file is served, absolute, under the feed's read id (public like the read
            link); null while the feed has no read link
    """

    id: str
    url: str
    feed_url: str
    read_url: None | str
    file: str
    file_url: None | str

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        url = self.url

        feed_url = self.feed_url

        read_url: None | str
        read_url = self.read_url

        file = self.file

        file_url: None | str
        file_url = self.file_url

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "id": id,
                "url": url,
                "feed_url": feed_url,
                "read_url": read_url,
                "file": file,
                "file_url": file_url,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        id = d.pop("id")

        url = d.pop("url")

        feed_url = d.pop("feed_url")

        def _parse_read_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        read_url = _parse_read_url(d.pop("read_url"))

        file = d.pop("file")

        def _parse_file_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        file_url = _parse_file_url(d.pop("file_url"))

        created = cls(
            id=id,
            url=url,
            feed_url=feed_url,
            read_url=read_url,
            file=file,
            file_url=file_url,
        )

        return created
