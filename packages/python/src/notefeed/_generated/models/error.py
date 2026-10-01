from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

from ..models.error_code import ErrorCode
from ..types import UNSET, Unset

T = TypeVar("T", bound="Error")


@_attrs_define
class Error:
    """
    Attributes:
        error (str): A short reason, for people
        code (ErrorCode | Unset): Stable machine-readable code; absent only on a 500
    """

    error: str
    code: ErrorCode | Unset = UNSET

    def to_dict(self) -> dict[str, Any]:
        error = self.error

        code: str | Unset = UNSET
        if not isinstance(self.code, Unset):
            code = self.code.value

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "error": error,
            }
        )
        if code is not UNSET:
            field_dict["code"] = code

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        error = d.pop("error")

        _code = d.pop("code", UNSET)
        code: ErrorCode | Unset
        if isinstance(_code, Unset):
            code = UNSET
        else:
            code = ErrorCode(_code)

        error = cls(
            error=error,
            code=code,
        )

        return error
