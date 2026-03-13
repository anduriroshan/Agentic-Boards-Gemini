"""
WebSocket routes for the Agentic Boards Live mode using Google ADK.
"""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import adk
import google.adk.sessions as sessions
from google.adk.agents import LiveRequestQueue
from google.genai import types
import asyncio

from src.agent.agent_adk import get_adk_agent
from src.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

@router.websocket("/agent/live")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice interaction.
    """
    await websocket.accept()
    logger.info("[WS] Client connected for Live sessions.")

    # 1. Initialize ADK Runner and Session
    dashboard_context = "The dashboard is currently empty." 
    agent = get_adk_agent(dashboard_context)
    
    session_service = sessions.InMemorySessionService()
    live_request_queue = LiveRequestQueue()
    runner = adk.Runner(
        agent=agent, 
        session_service=session_service,
        app_name="AgenticBoards"
    )
    
    # Flag to stop the upstream task
    stop_upstream = asyncio.Event()

    async def upstream():
        try:
            while not stop_upstream.is_set():
                try:
                    # Expecting raw audio bytes from the client
                    data = await asyncio.wait_for(websocket.receive_bytes(), timeout=1.0)
                    # Send as realtime blob to ADK (PCM 16kHz typical)
                    live_request_queue.send_realtime(types.Blob(data=data, mime_type="audio/pcm"))
                except asyncio.TimeoutError:
                    continue
        except WebSocketDisconnect:
            logger.info("[WS] Client disconnected.")
        except Exception as e:
            logger.error(f"[WS] Upstream error: {e}")
        finally:
            live_request_queue.close()

    upstream_task = asyncio.create_task(upstream())

    try:
        # 2. Setup Live Session
        # We must ensure the session exists in the session_service BEFORE calling run_live.
        user_id = "default_user"
        session_id = "live_session_01"
        app_name = "AgenticBoards"
        
        await session_service.create_session(user_id=user_id, session_id=session_id, app_name=app_name)
        logger.info(f"[WS] Session created for {user_id}/{session_id}")

        # adk.Runner.run_live is an async generator that yields Event objects.
        async for event in runner.run_live(
            live_request_queue=live_request_queue,
            user_id=user_id,
            session_id=session_id
        ):
            # 3. Handle Downstream Events (Agent -> WebSocket)
            
            # Case A: Handle Audio from Model
            if event.content and event.content.parts:
                for part in event.content.parts:
                    if part.inline_data and part.inline_data.data:
                        # Send audio bytes back to client
                        await websocket.send_bytes(part.inline_data.data)
                    elif part.text:
                        # Optionally send text/transcription
                        await websocket.send_json({"type": "text", "content": part.text})

            # Case B: Handle Tool Calls (Agent wants to update UI)
            func_calls = event.get_function_calls()
            if func_calls:
                for fc in func_calls:
                    logger.info(f"[WS] Agent tool call: {fc.name}")
                    await websocket.send_json({
                        "type": "tool_call",
                        "name": fc.name,
                        "args": fc.args
                    })

    except Exception as e:
        logger.error(f"[WS] Critical error in live session: {e}", exc_info=True)
        # Check specifically for authentication errors in the exception message
        if "authentication credentials" in str(e).lower() or "1008" in str(e):
            logger.error("[WS] Authentication failure detected. Verify GCP_PROJECT_ID and service_account.json.")
    finally:
        stop_upstream.set()
        await upstream_task
        logger.info("[WS] Live session cleanup.")
