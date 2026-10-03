from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.created import Created


T = TypeVar("T", bound="Posted")


@_attrs_define
class Posted:
    """The note the post is about: its text note, or with no `text` part its first picture

    Attributes:
        id (str):
        url (str): The note's page in the web UI
        feed_url (str): The feed's page in the web UI
        read_url (None | str): The feed's read-only RSS link, safe to share; null only if the server can't read the
            feed's stored read id, or if that id and the derived one both belong to other feeds
        file (str): The note's file name, `<id>.<extension>`. For an image note, pass it as a feed's `image` setting
        file_url (None | str): Where the note's file is served, absolute, under the feed's read id (public like the read
            link); null while the feed has no read link
        attachments (list[Created] | Unset): A multipart request's pictures, one per `file` part, in their order; absent
            for a raw body
    """

    id: str
    url: str
    feed_url: str
    read_url: None | str
    file: str
    file_url: None | str
    attachments: list[Created] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        url = self.url

        feed_url = self.feed_url

        read_url: None | str
        read_url = self.read_url

        file = self.file

        file_url: None | str
        file_url = self.file_url

        attachments: list[dict[str, Any]] | Unset = UNSET
        if not isinstance(self.attachments, Unset):
            attachments = []
            for attachments_item_data in self.attachments:
                attachments_item = attachments_item_data.to_dict()
                attachments.append(attachments_item)

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
        if attachments is not UNSET:
            field_dict["attachments"] = attachments

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.created import Created

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

        _attachments = d.pop("attachments", UNSET)
        attachments: list[Created] | Unset = UNSET
        if _attachments is not UNSET:
            attachments = []
            for attachments_item_data in _attachments:
                attachments_item = Created.from_dict(attachments_item_data)

                attachments.append(attachments_item)

        posted = cls(
            id=id,
            url=url,
            feed_url=feed_url,
            read_url=read_url,
            file=file,
            file_url=file_url,
            attachments=attachments,
        )

        return posted
