from __future__ import annotations

from collections.abc import Mapping
from io import BytesIO
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, File, FileTypes, Unset

T = TypeVar("T", bound="MultipartNote")


@_attrs_define
class MultipartNote:
    """
    Attributes:
        text (str | Unset): The markdown note (UTF-8): a field, or a file part (its name is ignored; its type, if any,
            `text/markdown` or `application/octet-stream`) to keep its line breaks as they are, since a form field's are
            sent as CRLF. At most one; required on a PUT. Its references to the files (`![](chart.png)`, `[x]: chart.png`)
            are swapped for the stored files; a file it never refers to is appended as `![](file)`
        file (list[File] | Unset): A picture: up to 10 parts, each with a file name (one path segment, 1 to 200
            characters, unique in the request) and its image `Content-Type`. An `alt.<file name>` field gives one its
            alternative text
    """

    text: str | Unset = UNSET
    file: list[File] | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        text = self.text

        file: list[FileTypes] | Unset = UNSET
        if not isinstance(self.file, Unset):
            file = []
            for file_item_data in self.file:
                file_item = file_item_data.to_tuple()

                file.append(file_item)

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if text is not UNSET:
            field_dict["text"] = text
        if file is not UNSET:
            field_dict["file"] = file

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        text = d.pop("text", UNSET)

        _file = d.pop("file", UNSET)
        file: list[File] | Unset = UNSET
        if _file is not UNSET:
            file = []
            for file_item_data in _file:
                file_item = File(payload=BytesIO(file_item_data))

                file.append(file_item)

        multipart_note = cls(
            text=text,
            file=file,
        )

        return multipart_note
