from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar, cast

from attrs import define as _attrs_define

from ..types import UNSET, Unset

T = TypeVar("T", bound="PostForm")


@_attrs_define
class PostForm:
    """
    Attributes:
        markdown (str): The note; or send a `file` part with an image instead
        title (str | Unset): The note's title, at most 100 characters, one line; empty or left out means the title is
            taken from the text (a markdown note) or there is none (an image)
        alt (str | Unset): Alternative text of an image note, at most 500 characters, one line
        password (str | Unset): Protects the feed: 1 to 256 printable ASCII characters, with no space at the start or
            end. Only honored on the post that creates the feed; an existing open feed answers 409. Empty is the same as
            leaving it out.
        tags (list[str] | Unset): Labels for the note: at most 10 tags, each 1 to 32 characters of letters, digits, `-`,
            `_`, `.` and `:`; case is folded to lowercase, duplicates are removed. Free labels, not verified, shown with the
            note (also to readers of the read link and RSS). Ignored when editing a note: an edit keeps its tags.
        read_id (str | Unset): The read id the feed gets when this post creates it: 3 to 64 characters (a-z, 0-9, - and
            _), random when left out or empty, ignored for a feed that exists. A short readable one is guessable: protect
            the feed with a password if that matters. 409 when it is taken
    """

    markdown: str
    title: str | Unset = UNSET
    alt: str | Unset = UNSET
    password: str | Unset = UNSET
    tags: list[str] | Unset = UNSET
    read_id: str | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        markdown = self.markdown

        title = self.title

        alt = self.alt

        password = self.password

        tags: list[str] | Unset = UNSET
        if not isinstance(self.tags, Unset):
            tags = self.tags

        read_id = self.read_id

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "markdown": markdown,
            }
        )
        if title is not UNSET:
            field_dict["title"] = title
        if alt is not UNSET:
            field_dict["alt"] = alt
        if password is not UNSET:
            field_dict["password"] = password
        if tags is not UNSET:
            field_dict["tags"] = tags
        if read_id is not UNSET:
            field_dict["read_id"] = read_id

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        markdown = d.pop("markdown")

        title = d.pop("title", UNSET)

        alt = d.pop("alt", UNSET)

        password = d.pop("password", UNSET)

        tags = cast(list[str], d.pop("tags", UNSET))

        read_id = d.pop("read_id", UNSET)

        post_form = cls(
            markdown=markdown,
            title=title,
            alt=alt,
            password=password,
            tags=tags,
            read_id=read_id,
        )

        return post_form
