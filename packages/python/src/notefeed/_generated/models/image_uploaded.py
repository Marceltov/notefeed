from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="ImageUploaded")


@_attrs_define
class ImageUploaded:
    """
    Attributes:
        file (str): The stored file's name: 32 hex characters of the SHA-256 plus the extension. Pass it as a feed's
            `image` setting
        url (str): Where the image is served, absolute, under the feed's read id; public like the read link
        markdown (str): `![](url)`, to paste into a note
    """

    file: str
    url: str
    markdown: str

    def to_dict(self) -> dict[str, Any]:
        file = self.file

        url = self.url

        markdown = self.markdown

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "file": file,
                "url": url,
                "markdown": markdown,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        file = d.pop("file")

        url = d.pop("url")

        markdown = d.pop("markdown")

        image_uploaded = cls(
            file=file,
            url=url,
            markdown=markdown,
        )

        return image_uploaded
