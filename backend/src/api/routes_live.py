"""
WebSocket routes for the Agentic Boards Live mode using Google ADK.
"""

import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from google import adk

from src.agent.agent_adk import get_adk_agent
from src.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

@router.websocket("/agent/live")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for real-time voice interaction.
    Expects audio/control messages from the frontend and streams
    responses from the ADK agent via Vertex AI.
    """
    await websocket.accept()
    logger.info("[WS] Client connected for Live sessions.")

    # 1. Initialize ADK Runner and Session
    # We'll use the ADK Runner to manage the Multimodal Live API session.
    # Note: In a real implementation, we would extract dashboard_context 
    # from a previous HTTP call or a session state.
    dashboard_context = "The dashboard is currently empty." 
    agent = get_adk_agent(dashboard_context)
    
    # The ADK Runner handles the lifecycle of the agent execution.
    runner = adk.Runner(agent=agent)
    
    # 2. Setup Live Session
    # ADK's Multimodal Live support typically uses a queue to bridge 
    # the WebSocket with the model's live stream.
    try:
        async with runner.run_live() as live_session:
            logger.info("[WS] ADK Live session started.")
            
            # Loop for bidirectional communication
            # Upstream: WebSocket -> ADK Live Session
            # Downstream: ADK Live Session -> WebSocket
            
            async def upstream():
                try:
                    while True:
                        data = await websocket.receive_bytes()
                        # data could be audio frames or control JSON
                        # In the real ADK implementation, we would use live_session.push(...)
                        # to send audio/video to the model.
                        await live_session.push_audio(data) 
                except WebSocketDisconnect:
                    logger.info("[WS] Upstream closed.")
                    
            async def downstream():
                try:
                    async for event in live_session.events():
                        # event could be AudioGeneration, TextGeneration, or ToolCall
                        if isinstance(event, adk.AudioEvent):
                            await websocket.send_bytes(event.audio_content)
                        elif isinstance(event, adk.ToolCallEvent):
                            # Dispatch tool call result back to UI if needed
                            await websocket.send_json({
                                "type": "tool_call",
                                "name": event.tool_name,
                                "args": event.arguments
                            })
                except Exception as e:
                    logger.error(f"[WS] Downstream error: {e}")

            # Run both upstream and downstream concurrently
            import asyncio
            await asyncio.gather(upstream(), downstream())

    except WebSocketDisconnect:
        logger.info("[WS] Client disconnected.")
    except Exception as e:
        logger.error(f"[WS] Error in live session: {e}")
    finally:
        logger.info("[WS] Live session cleanup.")
