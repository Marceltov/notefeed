"""Post markdown notes to a notefeed server."""

from importlib.metadata import version as _version

__version__ = _version("notefeed")

from .client import AuthError, Client, ConfigError, InvalidNoteError, Note, NotefeedError, NoteTooLargeError  # noqa: E402

__all__ = ["AuthError", "Client", "ConfigError", "InvalidNoteError", "Note", "NotefeedError", "NoteTooLargeError"]
