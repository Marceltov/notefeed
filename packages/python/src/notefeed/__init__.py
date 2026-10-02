"""Post and read markdown notes on a notefeed server."""

from importlib.metadata import version as _version

__version__ = _version("notefeed")

from .client import (  # noqa: E402
    AuthError,
    Client,
    ConfigError,
    Created,
    Feed,
    ImageUploaded,
    InvalidRequestError,
    LimitReachedError,
    Note,
    NotefeedError,
    NotFoundError,
    NoteTooLargeError,
    RateLimitedError,
)

__all__ = [
    "AuthError",
    "Client",
    "ConfigError",
    "Created",
    "Feed",
    "ImageUploaded",
    "InvalidRequestError",
    "LimitReachedError",
    "Note",
    "NotefeedError",
    "NotFoundError",
    "NoteTooLargeError",
    "RateLimitedError",
]
