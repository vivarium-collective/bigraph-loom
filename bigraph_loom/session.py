"""Session management for multi-user state isolation."""

from __future__ import annotations

import copy
import time
import uuid
from threading import Lock
from typing import Any


class SavedBigraph:
    """A named bigraph snapshot with optional view state."""

    __slots__ = ("name", "state", "schema", "view_state", "saved_at")

    def __init__(
        self,
        name: str,
        state: dict,
        schema: dict | None = None,
        view_state: dict | None = None,
    ):
        self.name = name
        self.state = state
        self.schema = schema
        self.view_state = view_state  # {positions, collapsed, hidden, viewMode, zoom, pan}
        self.saved_at = time.time()


class Session:
    """Holds one user's bigraph state, schema, and saved library."""

    __slots__ = ("state", "schema", "last_accessed", "library")

    def __init__(
        self,
        state: dict[str, Any] | None = None,
        schema: dict[str, Any] | None = None,
    ):
        self.state: dict[str, Any] = state or {}
        self.schema: dict[str, Any] | None = schema
        self.last_accessed: float = time.time()
        self.library: dict[str, SavedBigraph] = {}

    def touch(self) -> None:
        self.last_accessed = time.time()


class SessionStore:
    """In-memory session store with TTL-based cleanup."""

    def __init__(self, ttl_seconds: int = 3600):
        self._sessions: dict[str, Session] = {}
        self._lock = Lock()
        self._ttl = ttl_seconds
        self._default_state: dict[str, Any] = {}
        self._default_schema: dict[str, Any] | None = None
        # Example .pbg files available to all sessions
        self.examples: dict[str, SavedBigraph] = {}

    def set_defaults(
        self,
        state: dict[str, Any],
        schema: dict[str, Any] | None = None,
    ) -> None:
        self._default_state = copy.deepcopy(state)
        self._default_schema = copy.deepcopy(schema) if schema else None

    def add_example(
        self,
        name: str,
        state: dict,
        schema: dict | None = None,
        view_state: dict | None = None,
    ) -> None:
        """Register a built-in example .pbg file."""
        self.examples[name] = SavedBigraph(
            name,
            copy.deepcopy(state),
            copy.deepcopy(schema) if schema else None,
            copy.deepcopy(view_state) if view_state else None,
        )

    def get(self, session_id: str) -> Session:
        with self._lock:
            if session_id not in self._sessions:
                self._sessions[session_id] = Session(
                    state=copy.deepcopy(self._default_state),
                    schema=copy.deepcopy(self._default_schema),
                )
            session = self._sessions[session_id]
            session.touch()
            return session

    def create(self) -> str:
        session_id = uuid.uuid4().hex[:16]
        with self._lock:
            self._sessions[session_id] = Session(
                state=copy.deepcopy(self._default_state),
                schema=copy.deepcopy(self._default_schema),
            )
        return session_id

    def cleanup(self) -> int:
        cutoff = time.time() - self._ttl
        with self._lock:
            expired = [
                sid for sid, s in self._sessions.items()
                if s.last_accessed < cutoff
            ]
            for sid in expired:
                del self._sessions[sid]
        return len(expired)

    @property
    def count(self) -> int:
        return len(self._sessions)


# Global session store
sessions = SessionStore()
