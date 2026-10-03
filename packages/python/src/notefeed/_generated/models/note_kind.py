from enum import StrEnum


class NoteKind(StrEnum):
    IMAGE = "image"
    MARKDOWN = "markdown"

    def __str__(self) -> str:
        return str(self.value)
