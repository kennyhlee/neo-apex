"""In-memory exchange code store for cross-service token handoff."""
import secrets
import time


class ExchangeStore:
    def __init__(self, ttl_seconds: int = 30):
        self.ttl_seconds = ttl_seconds
        self._codes: dict[str, tuple[str, float]] = {}

    def create(self, token: str) -> str:
        code = secrets.token_urlsafe(32)
        expires_at = time.monotonic() + self.ttl_seconds
        self._codes[code] = (token, expires_at)
        return code

    def redeem(self, code: str) -> str | None:
        entry = self._codes.pop(code, None)
        if entry is None:
            return None
        token, expires_at = entry
        if time.monotonic() > expires_at:
            return None
        return token

    def cleanup(self) -> None:
        now = time.monotonic()
        expired = [k for k, (_, exp) in self._codes.items() if now > exp]
        for k in expired:
            del self._codes[k]
