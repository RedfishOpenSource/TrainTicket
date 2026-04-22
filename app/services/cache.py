from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Generic, TypeVar


T = TypeVar("T")


@dataclass(slots=True)
class CacheEntry(Generic[T]):
    value: T
    expires_at: datetime


class TTLCache(Generic[T]):
    def __init__(self, ttl_seconds: int = 60) -> None:
        self.ttl_seconds = ttl_seconds
        self._entries: dict[str, CacheEntry[T]] = {}

    def get(self, key: str) -> T | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.expires_at <= datetime.utcnow():
            self._entries.pop(key, None)
            return None
        return entry.value

    def set(self, key: str, value: T) -> None:
        self._entries[key] = CacheEntry(
            value=value,
            expires_at=datetime.utcnow() + timedelta(seconds=self.ttl_seconds),
        )
