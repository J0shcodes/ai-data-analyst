import asyncio
import threading
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pandas as pd

from models.dataset import DatasetProfile

DEFAULT_TTL_MINUTES = 30
EVICTION_INTERVAL_SECONDS = 60


@dataclass
class DatasetEntry:
    df: pd.DataFrame
    profile: DatasetProfile
    created_at: datetime
    last_accessed_at: datetime


class DatasetStore:
    """
    Process-global, in-memory dataset store keyed by dataset_id.
    Not persisted across restarts, not shared across processes.
    """

    def __init__(self, ttl_minute: int = DEFAULT_TTL_MINUTES) -> None:
        self._entries: dict[str, DatasetEntry] = {}
        self._ttl = ttl_minute
        self._lock = threading.Lock()

    def create(
        self, dataset_id: str, df: pd.DataFrame, profile: DatasetProfile
    ) -> DatasetEntry:
        now = datetime.now(timezone.utc)
        entry = DatasetEntry(
            df=df, profile=profile, created_at=now, last_accessed_at=now
        )
        with self._lock:
            self._entries[dataset_id] = entry
        return entry

    def get(self, dataset_id: str) -> DatasetEntry | None:
        with self._lock:
            entry = self._entries.get(dataset_id)
            if entry is not None:
                entry.last_accessed_at = datetime.now(timezone.utc)
            return entry

    def list_all(self) -> list[tuple[str, DatasetEntry]]:
        with self._lock:
            return list(self._entries.items())

    def delete(self, dataset_id: str) -> bool:
        with self._lock:
            return self._entries.pop(dataset_id, None) is not None

    def evict_expired(self) -> list[str]:
        now = datetime.now(timezone.utc)
        with self._lock:
            expired = [
                dataset_id
                for dataset_id, entry in self._entries.items()
                if now - entry.last_accessed_at > timedelta(minutes=self._ttl)
            ]
            for dataset_id in expired:
                del self._entries[dataset_id]
        return expired


dataset_store = DatasetStore()


async def run_eviction_loop(
    store: DatasetStore, interval_seconds: int = EVICTION_INTERVAL_SECONDS
) -> None:
    while True:
        await asyncio.sleep(interval_seconds)
        store.evict_expired()
