"""Post markdown notes to a notefeed server."""

from importlib.metadata import version as _version

__version__ = _version("notefeed")

from .client import (  # noqa: E402
    AuthError,
    Client,
    ConfigError,
    InvalidNoteError,
    LimitReachedError,
    Note,
    NotefeedError,
    NoteTooLargeError,
    RateLimitedError,
)

__all__ = [
    "AuthError",
    "Client",
    "ConfigError",
    "InvalidNoteError",
    "LimitReachedError",
    "Note",
    "NotefeedError",
    "NoteTooLargeError",
    "RateLimitedError",
]
