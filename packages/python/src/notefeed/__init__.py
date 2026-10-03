"""Post and read markdown notes on a notefeed server."""

from importlib.metadata import version as _version

__version__ = _version("notefeed")

from .client import (  # noqa: E402
    Attachment,
    AuthError,
    Client,
    ConfigError,
    Created,
    Feed,
    InvalidRequestError,
    LimitReachedError,
    Note,
    NotefeedError,
    NotFoundError,
    NoteTooLargeError,
    Posted,
    RateLimitedError,
)

__all__ = [
    "Attachment",
    "AuthError",
    "Client",
    "ConfigError",
    "Created",
    "Feed",
    "InvalidRequestError",
    "LimitReachedError",
    "Note",
    "NotefeedError",
    "NotFoundError",
    "NoteTooLargeError",
    "Posted",
    "RateLimitedError",
]
