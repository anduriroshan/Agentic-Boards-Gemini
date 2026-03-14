from src.api.live_session_state import LiveSessionCoordinator, TurnLifecycleState


def _context_payload(tile_id: str) -> dict:
    return {
        "type": "context_update",
        "database_provider": "databricks",
        "tiles": [{"id": tile_id, "title": "Tile", "type": "chart"}],
    }


def test_context_update_queued_while_model_active_then_flushes_at_idle_boundary():
    coordinator = LiveSessionCoordinator()

    started, turn_id = coordinator.mark_model_activity(now=1.0)
    assert started is True
    assert turn_id == "turn_1"
    assert coordinator.turn_state == TurnLifecycleState.MODEL_ACTIVE

    queued = coordinator.queue_context_update(_context_payload("tile-1"))
    assert queued is True
    assert coordinator.pending_context is not None
    assert coordinator.should_flush_context() is False

    ended_turn_id = coordinator.maybe_end_turn_on_idle(now=2.0, idle_after_seconds=0.8)
    assert ended_turn_id == "turn_1"
    assert coordinator.turn_state == TurnLifecycleState.IDLE
    assert coordinator.should_flush_context() is True

    pending = coordinator.consume_pending_context()
    assert pending is not None
    assert pending.payload["tiles"][0]["id"] == "tile-1"


def test_duplicate_context_updates_are_coalesced():
    coordinator = LiveSessionCoordinator()
    payload = _context_payload("tile-2")

    assert coordinator.queue_context_update(payload) is True
    assert coordinator.queue_context_update(payload) is False

    pending = coordinator.consume_pending_context()
    assert pending is not None
    coordinator.last_context_hash = pending.payload_hash

    assert coordinator.queue_context_update(payload) is False


def test_turn_boundaries_and_turn_ids_increment_predictably():
    coordinator = LiveSessionCoordinator()

    started_1, turn_1 = coordinator.mark_model_activity(now=1.0)
    assert started_1 is True
    assert turn_1 == "turn_1"

    started_2, turn_2 = coordinator.mark_model_activity(now=1.1)
    assert started_2 is False
    assert turn_2 == "turn_1"

    assert coordinator.maybe_end_turn_on_idle(now=2.2, idle_after_seconds=0.8) == "turn_1"

    started_3, turn_3 = coordinator.mark_model_activity(now=2.3)
    assert started_3 is True
    assert turn_3 == "turn_2"


def test_force_end_and_interrupt_are_idempotent_when_idle():
    coordinator = LiveSessionCoordinator()

    assert coordinator.maybe_end_turn_on_idle(force=True) is None
    assert coordinator.mark_interrupted() is None

    coordinator.mark_model_activity(now=1.0)
    assert coordinator.mark_interrupted() == "turn_1"
    assert coordinator.turn_state == TurnLifecycleState.IDLE
    assert coordinator.mark_interrupted() is None
