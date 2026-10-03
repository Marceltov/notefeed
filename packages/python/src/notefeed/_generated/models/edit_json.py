from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="EditJson")


@_attrs_define
class EditJson:
    """
    Attributes:
        markdown (str | Unset): The new text; only for a markdown note
        title (str | Unset): The note's title, at most 100 characters, one line; empty or left out means the title is
            taken from the text (a markdown note) or there is none (an image)
        alt (str | Unset): Alternative text of an image note, at most 500 characters, one line
    """

    markdown: str | Unset = UNSET
    title: str | Unset = UNSET
    alt: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        markdown = self.markdown

        title = self.title

        alt = self.alt

        field_dict: dict[str, Any] = {}

        field_dict.update({})
        if markdown is not UNSET:
            field_dict["markdown"] = markdown
        if title is not UNSET:
            field_dict["title"] = title
        if alt is not UNSET:
            field_dict["alt"] = alt

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        markdown = d.pop("markdown", UNSET)

        title = d.pop("title", UNSET)

        alt = d.pop("alt", UNSET)

        edit_json = cls(
            markdown=markdown,
            title=title,
            alt=alt,
        )

        return edit_json
