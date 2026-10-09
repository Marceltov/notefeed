from enum import StrEnum


class ErrorCode(StrEnum):
    AUTH = "auth"
    EMPTY_NOTE = "empty_note"
    FEED_EXISTS = "feed_exists"
    FEED_LIMIT = "feed_limit"
    IMAGES_OFF = "images_off"
    IMAGE_LIMIT = "image_limit"
    INVALID_BODY = "invalid_body"
    INVALID_FEED = "invalid_feed"
    INVALID_REQUEST = "invalid_request"
    NOTE_LIMIT = "note_limit"
    NOT_FOUND = "not_found"
    RATE_LIMITED = "rate_limited"
    RESERVED_FEED = "reserved_feed"
    TAKEN = "taken"
    TOO_LARGE = "too_large"
    TOO_MANY_ATTEMPTS = "too_many_attempts"
    UNSUPPORTED_TYPE = "unsupported_type"

    def __str__(self) -> str:
        return str(self.value)
