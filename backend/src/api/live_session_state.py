import hashlib
import json
import time
from dataclasses import dataclass
from enum import Enum
from typing import Any

IDLE_TIMEOUT_SECONDS = 0.8


class TurnLifecycleState(str, Enum):
    IDLE = "IDLE"
    MODEL_ACTIVE = "MODEL_ACTIVE"


@dataclass
class PendingContextUpdate:
    payload: dict[str, Any]
    payload_hash: str


class LiveSessionCoordinator:
    """Tracks live turn state and queued dashboard context updates."""

    def __init__(self) -> None:
        self.turn_state = TurnLifecycleState.IDLE
        self.turn_id: str | None = None
        self.turn_seq = 0
        self.last_model_activity_ts = 0.0
        self.pending_context: PendingContextUpdate | None = None
        self.last_context_hash: str | None = None

    def queue_context_update(self, payload: dict[str, Any]) -> bool:
        payload_hash = hashlib.sha1(
            json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        if self.last_context_hash == payload_hash:
            return False
        if self.pending_context and self.pending_context.payload_hash == payload_hash:
            return False

        self.pending_context = PendingContextUpdate(payload=payload, payload_hash=payload_hash)
        return True

    def should_flush_context(self) -> bool:
        return self.turn_state == TurnLifecycleState.IDLE and self.pending_context is not None

    def consume_pending_context(self) -> PendingContextUpdate | None:
        pending = self.pending_context
        self.pending_context = None
        return pending

    def mark_model_activity(self, now: float | None = None) -> tuple[bool, str]:
        ts = now if now is not None else time.monotonic()
        self.last_model_activity_ts = ts

        if self.turn_state == TurnLifecycleState.IDLE:
            self.turn_state = TurnLifecycleState.MODEL_ACTIVE
            self.turn_seq += 1
            self.turn_id = f"turn_{self.turn_seq}"
            return True, self.turn_id

        if self.turn_id is None:
            self.turn_seq += 1
            self.turn_id = f"turn_{self.turn_seq}"

        return False, self.turn_id

    def maybe_end_turn_on_idle(
        self,
        now: float | None = None,
        idle_after_seconds: float = IDLE_TIMEOUT_SECONDS,
        force: bool = False,
    ) -> str | None:
        if self.turn_state != TurnLifecycleState.MODEL_ACTIVE:
            return None

        ts = now if now is not None else time.monotonic()
        if not force and (ts - self.last_model_activity_ts) < idle_after_seconds:
            return None

        ended_turn_id = self.turn_id
        self.turn_state = TurnLifecycleState.IDLE
        return ended_turn_id

    def mark_interrupted(self) -> str | None:
        if self.turn_state != TurnLifecycleState.MODEL_ACTIVE:
            return None
        interrupted_turn_id = self.turn_id
        self.turn_state = TurnLifecycleState.IDLE
        return interrupted_turn_id
