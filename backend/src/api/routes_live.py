import json
import logging
import time
import uuid
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState
from google import adk
import google.adk.sessions as sessions
from google.adk.agents import LiveRequestQueue
from google.genai import types
import asyncio

from contextvars import ContextVar
from src.agent.agent_adk import get_adk_agent
from src.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Log Suppression for Normal Closures ──────────────────────────────────────
class NormalClosureFilter(logging.Filter):
    """Suppresses misleading 1000 None APIErrors from ADK/GenAI during clean closure."""
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        # Suppress "An unexpected error occurred in live flow: 1000 None"
        if "1000 None" in msg or "ConnectionClosedOK" in msg:
            return False
        return True

# Apply filter to the specific ADK logger that misreports normal closures as errors
adk_logger = logging.getLogger("google_adk.google.adk.flows.llm_flows.base_llm_flow")
adk_logger.addFilter(NormalClosureFilter())

# Global context for the current session's activity log
_session_activity_log: ContextVar[list[str]] = ContextVar("_session_activity_log", default=[])
# Context for the current WebSocket connection to allow tools to send status updates
_current_websocket: ContextVar[WebSocket | None] = ContextVar("_current_websocket", default=None)
_current_step_id: ContextVar[str | None] = ContextVar("_current_step_id", default=None)

def get_session_activity() -> list[str]:
    """Helper for the get_recent_activity tool to access current session history."""
    return _session_activity_log.get()

# Replicate tool mapping from routes_chat
_TOOL_AGENT: dict[str, tuple[str, str]] = {
    "search_metadata":     ("DataAgent",      "search"),
    "execute_sql":         ("DataAgent",      "database"),
    "execute_bigquery":    ("DataAgent",      "database"),
    "get_bigquery_schema": ("DataAgent",      "database"),
    "create_visualization":("VizAgent",       "bar-chart-3"),
    "create_kpi_tile":     ("VizAgent",       "chart-bar"),
    "create_text_tile":    ("VizAgent",       "file-text"),
    "create_data_table":   ("VizAgent",       "table"),
    "update_data_table":   ("VizAgent",       "table"),
    "modify_dashboard":    ("DashboardAgent", "layout"),
    "get_recent_activity": ("Orchestrator",   "history"),
}


@router.websocket("/agent/live")
async def websocket_endpoint(websocket: WebSocket):
    logger.info(f"[WS] Incoming connection request from {websocket.client}")
    await websocket.accept()
    logger.info(f"[WS] Connection ACCEPTED for {websocket.client}")

    # Initialize a new activity log for this task
    log = []
    _session_activity_log.set(log)
    _current_websocket.set(websocket)
    
    dashboard_context = "The dashboard is currently empty."
    agent = get_adk_agent(dashboard_context)
    
    session_service = sessions.InMemorySessionService()
    live_request_queue = LiveRequestQueue()
    runner = adk.Runner(
        agent=agent, 
        session_service=session_service,
        app_name="AgenticBoards"
    )
    
    stop_upstream = asyncio.Event()
    # Shared state: tracks when the model last produced audio, used to gate context_updates
    generation_state = {"last_audio_ts": 0.0}

    async def upstream():
        try:
            while not stop_upstream.is_set():
                try:
                    msg = await websocket.receive()
                    if msg["type"] == "websocket.disconnect":
                        logger.info("[WS] Client disconnected via websocket.disconnect")
                        break
                        
                    if "bytes" in msg:
                        # Audio data
                        # logger.info(f"[WS] Received bytes message (audio), size: {len(msg['bytes'])}")
                        live_request_queue.send_realtime(types.Blob(data=msg["bytes"], mime_type="audio/pcm;rate=16000"))
                    elif "text" in msg:
                        try:
                            data = json.loads(msg["text"])
                            msg_type = data.get("type")
                            logger.info(f"[WS] Received text message: {msg_type}, payload snippet: {str(data)[:100]}...")
                            
                            if msg_type == "context_update":
                                # Suppress if the model sent audio in the last 4s — injecting a new
                                # user turn mid-response creates a second voice stream.
                                since_last_audio = time.time() - generation_state["last_audio_ts"]
                                if since_last_audio < 4.0:
                                    logger.info(f"[WS] Suppressed context_update — model active ({since_last_audio:.1f}s ago)")
                                    continue
                                tiles = data.get("tiles", [])
                                provider = data.get("database_provider", "databricks")
                                
                                connection_flag = f"[ACTIVE CONNECTION: {provider.upper()}]"
                                context_str = (
                                    f"SYSTEM NOTIFICATION: {connection_flag}\n"
                                    "The user has updated or loaded a dashboard session. "
                                    f"Current tiles: {json.dumps(tiles)}. "
                                    "Update your internal memory with these tile names and IDs immediately. "
                                    "STRICTLY follow the ACTIVE CONNECTION flag when choosing SQL executors. "
                                    "DO NOT call any tools or speak in response to this message. "
                                    "Wait for the user to speak or ask a question before taking any action."
                                )
                                logger.info(f"[WS] Injecting dashboard context: {len(tiles)} tiles")
                                # Use role='user' so the Multimodal Live API treats it as a conversation turn
                                live_request_queue.send_content(types.Content(
                                    parts=[types.Part(text=context_str)],
                                    role="user"
                                ))
                        except Exception as e:
                            logger.error(f"[WS] Failed to parse JSON message: {e}")
                except asyncio.TimeoutError:
                    continue
        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected.")
        except Exception as e:
            logger.error(f"[WS] Upstream error: {e}")
        finally:
            live_request_queue.close()

    upstream_task = asyncio.create_task(upstream())

    # Track the last SQL query to provide query_meta to the frontend
    last_sql_info = {"sql": None, "provider": "bigquery"}

    try:
        user_id = "default_user"
        session_id = "live_session_01"
        app_name = "AgenticBoards"
        
        await session_service.create_session(user_id=user_id, session_id=session_id, app_name=app_name)
        logger.info(f"[WS] Session created for {user_id}/{session_id}")

        async for event in runner.run_live(
            live_request_queue=live_request_queue,
            user_id=user_id,
            session_id=session_id
        ):
            # 0. Check if websocket is still open
            if websocket.client_state != WebSocketState.CONNECTED:
                logger.info(f"[WS] Websocket not connected ({websocket.client_state}), skipping event processing.")
                break

            try:
                # 1. Handle Audio & Text
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.inline_data and part.inline_data.data:
                            generation_state["last_audio_ts"] = time.time()  # model is speaking
                            await websocket.send_bytes(part.inline_data.data)
                        elif part.thought:
                            # Move thinking to Agent Activity panel
                            await websocket.send_json({
                                "type": "agent_activity",
                                "step": {
                                    "step_id": str(uuid.uuid4()),
                                    "phase": "reasoning",
                                    "agent": "Orchestrator",
                                    "icon": "brain",
                                    "summary": part.thought[:150] + ("..." if len(part.thought) > 150 else ""),
                                    "status": "done",
                                    "ts": int(time.time() * 1000)
                                }
                            })
                        elif part.text:
                            logger.info(f"[WS] Agent text: {part.text}")
                            log.append(f"Responded with text: {part.text[:50]}...")
                            # Activity step for final response
                            await websocket.send_json({
                                "type": "agent_activity",
                                "step": {
                                    "step_id": str(uuid.uuid4()),
                                    "phase": "final",
                                    "agent": "Orchestrator",
                                    "icon": "brain",
                                    "summary": part.text[:100] + ("..." if len(part.text) > 100 else ""),
                                    "status": "done",
                                    "ts": int(time.time() * 1000)
                                }
                            })
                # 2. Handle Tool Calls - forward UI metadata only, ADK handles execution internally
                func_calls = event.get_function_calls()
                if func_calls:
                    for fc in func_calls:
                        logger.info(f"[WS] Agent tool call: {fc.name}")
                        log.append(f"Called tool: {fc.name}")
                        
                        # Track SQL for enriching visualization calls
                        if fc.name == "execute_bigquery":
                            last_sql_info["sql"] = fc.args.get("sql")
                            last_sql_info["provider"] = "bigquery"
                        elif fc.name == "execute_sql":
                            last_sql_info["sql"] = fc.args.get("sql")
                            last_sql_info["provider"] = "databricks"
                        
                        # Send agent_activity to frontend for the activity panel
                        agent_name, icon = _TOOL_AGENT.get(fc.name, ("Agent", "cpu"))
                        try:
                            await websocket.send_json({
                                "type": "agent_activity",
                                "step": {
                                    "step_id": str(uuid.uuid4()),
                                    "phase": "call",
                                    "agent": agent_name,
                                    "icon": icon,
                                    "tool": fc.name,
                                    "summary": f"Running {fc.name}...",
                                    "status": "running",
                                    "ts": int(time.time() * 1000)
                                }
                            })
                            
                            # Send tool_call so frontend can render tiles/charts
                            payload = {
                                "type": "tool_call",
                                "name": fc.name,
                                "args": fc.args
                            }
                            # Enrich viz tools with SQL context
                            if fc.name in ("create_visualization", "create_data_table", "create_kpi_tile") and last_sql_info["sql"]:
                                from src.api.routes_charts import detect_sql_params
                                payload["query_meta"] = {
                                    "sql": last_sql_info["sql"],
                                    "params": detect_sql_params(last_sql_info["sql"]),
                                    "type": last_sql_info["provider"]
                                }
                            await websocket.send_json(payload)
                        except (WebSocketDisconnect, RuntimeError):
                            break

            except (WebSocketDisconnect, RuntimeError):
                logger.info("[WS] Client disconnected during event handling.")
                break

    except Exception as e:
        if "1000" in str(e) and "None" in str(e):
            logger.info("[WS] Live session closed normally (1000).")
        else:
            logger.error(f"[WS] Critical error in live session: {e}", exc_info=True)
    finally:
        stop_upstream.set()
        await upstream_task
        logger.info("[WS] Live session cleanup.")
