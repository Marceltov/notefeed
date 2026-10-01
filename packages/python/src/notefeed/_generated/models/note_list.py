from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any, Self, TypeVar, cast

from attrs import define as _attrs_define

if TYPE_CHECKING:
    from ..models.note import Note


T = TypeVar("T", bound="NoteList")


@_attrs_define
class NoteList:
    """
    Attributes:
        notes (list[Note]): Newest first
        next_ (None | str): Pass as `before` for the next (older) page; null on the last page
    """

    notes: list[Note]
    next_: None | str

    def to_dict(self) -> dict[str, Any]:
        notes = []
        for notes_item_data in self.notes:
            notes_item = notes_item_data.to_dict()
            notes.append(notes_item)

        next_: None | str
        next_ = self.next_

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "notes": notes,
                "next": next_,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        from ..models.note import Note

        d = dict(src_dict)
        notes = []
        _notes = d.pop("notes")
        for notes_item_data in _notes:
            notes_item = Note.from_dict(notes_item_data)

            notes.append(notes_item)

        def _parse_next_(data: object) -> None | str:
            if data is None:
                return data
            return cast(None | str, data)

        next_ = _parse_next_(d.pop("next"))

        note_list = cls(
            notes=notes,
            next_=next_,
        )

        return note_list
