from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Self, TypeVar

from attrs import define as _attrs_define

T = TypeVar("T", bound="PasswordJson")


@_attrs_define
class PasswordJson:
    """
    Attributes:
        password (str): The new password, 1 to 256 characters
    """

    password: str

    def to_dict(self) -> dict[str, Any]:
        password = self.password

        field_dict: dict[str, Any] = {}

        field_dict.update(
            {
                "password": password,
            }
        )

        return field_dict

    @classmethod
    def from_dict(cls, src_dict: Mapping[str, Any]) -> Self:
        d = dict(src_dict)
        password = d.pop("password")

        password_json = cls(
            password=password,
        )

        return password_json
