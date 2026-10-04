from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

if TYPE_CHECKING:
    from ..models.created import Created


T = TypeVar("T", bound="NoteEdited")


@_attrs_define
class NoteEdited:
    """
    Attributes:
        id (str): The note's id: a UTC time to the second plus a random UUID for notes made here; any name without a dot
            for a file placed by hand
        type_ (str): The media type of the note's file: `text/markdown`, `image/png`, `image/jpeg`, `image/gif` or
            `image/webp`
        file (str): The note's file name, `<id>.<extension>`
        file_url (None | str): Where the note's file is served, absolute, under the feed's read id (public like the read
            link); null while the feed has no read link
        size (int): The size of the note's file in bytes
        title (str): The title set for the note, else the first heading or the first non-empty line of a markdown note,
            else the picture's alt text; may be empty
        created_at (datetime.datetime): When the note was posted (UTC)
        url (str): The note's page in the web UI
        tags (list[str]): Labels the poster gave the note (not verified, and shown to readers like the note itself);
            empty when none
        content (str | Unset): The note's text, byte-for-byte as posted: for a text type (markdown) only; absent for a
            picture
        alt (str | Unset): Alternative text of an image note, when it has one
        name (str | Unset): The file name an image was posted with, when it came with one
        sender (None | str | Unset): Verified sign-in name of the poster; absent when the note was posted without a
            sign-in
        attachments (list[Created] | Unset): A multipart request's pictures, one per `file` part, in their order; absent
            for a raw body
    """

    id: str
    type_: str
    file: str
    file_url: None | str
    size: int
    title: str
    created_at: datetime.datetime
    url: str
    tags: list[str]
    content: str | Unset = UNSET
    alt: str | Unset = UNSET
    name: str | Unset = UNSET
    sender: None | str | Unset = UNSET
    attachments: list[Created] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        id = self.id

        type_ = self.type_

        file = self.file

        file_url: None | str
        file_url = self.file_url

        size = self.size

        title = self.title

        created_at = self.created_at.isoformat()

        url = self.url

        tags = self.tags

        content = self.content

        alt = self.alt

        name = self.name

        sender: None | str | Unset
        if isinstance(self.sender, Unset):
            sender = UNSET
        else:
            sender = self.sender

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
                "type": type_,
                "file": file,
                "file_url": file_url,
                "size": size,
                "title": title,
                "created_at": created_at,
                "url": url,
                "tags": tags,
            }
        )
        if content is not UNSET:
            field_dict["content"] = content
        if alt is not UNSET:
            field_dict["alt"] = alt
        if name is not UNSET:
            field_dict["name"] = name
        if sender is not UNSET:
            field_dict["sender"] = sender
        if attachments is not UNSET:
            field_dict["attachments"] = attachments

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.created import Created

        d = dict(src_dict)
        id = d.pop("id")

        type_ = d.pop("type")

        file = d.pop("file")

        def _parse_file_url(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        file_url = _parse_file_url(d.pop("file_url"))

        size = d.pop("size")

        title = d.pop("title")

        created_at = datetime.datetime.fromisoformat(d.pop("created_at"))

        url = d.pop("url")

        tags = cast(list[str], d.pop("tags"))

        content = d.pop("content", UNSET)

        alt = d.pop("alt", UNSET)

        name = d.pop("name", UNSET)

        def _parse_sender(data: object) -> None | str | Unset:
            if data is None:
                return data
            if isinstance(data, Unset):
                return data
            return cast(None | str | Unset, data)

        sender = _parse_sender(d.pop("sender", UNSET))

        _attachments = d.pop("attachments", UNSET)
        attachments: list[Created] | Unset = UNSET
        if _attachments is not UNSET:
            attachments = []
            for attachments_item_data in _attachments:
                attachments_item = Created.from_dict(attachments_item_data)

                attachments.append(attachments_item)

        note_edited = cls(
            id=id,
            type_=type_,
            file=file,
            file_url=file_url,
            size=size,
            title=title,
            created_at=created_at,
            url=url,
            tags=tags,
            content=content,
            alt=alt,
            name=name,
            sender=sender,
            attachments=attachments,
        )

        return note_edited
