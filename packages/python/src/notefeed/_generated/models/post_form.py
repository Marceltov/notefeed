from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PostForm")


@_attrs_define
class PostForm:
    """
    Attributes:
        markdown (str):
    """

    markdown: str

    def to_dict(self) -> dict[str, Any]:
        markdown = self.markdown

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "markdown": markdown,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        markdown = d.pop("markdown")

        post_form = cls(
            markdown=markdown,
        )

        return post_form
