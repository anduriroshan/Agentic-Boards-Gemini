"""
LangChain-compatible wrapper around the Accenture GenAI gateway.

Subclasses ``BaseChatModel`` so it plugs into any LangGraph node.

Message mapping
    SystemMessage.content  →  payload["context"]
    HumanMessage.content   →  payload["question"]
    Conversation history   →  payload["example"] array

Tool-calling
    The Accenture endpoint is a plain ChatCompletion endpoint with no
    native function-calling support.  We emulate OpenAI-style tool_calls
    by injecting a tool-schema block into the system prompt and parsing
    the model's JSON response back into AIMessage.tool_calls so that
    LangGraph's ToolNode works transparently.
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from typing import Any, List, Optional, Sequence

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.outputs import ChatGeneration, ChatResult

from src.llm.accenture_client import AccentureGenAIClient

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tool-schema → prompt builder
# ---------------------------------------------------------------------------

def _tool_schema_block(tools: Sequence) -> str:
    """Render all tool schemas as a compact JSON block inside the system prompt."""
    schemas = []
    for t in tools:
        schema = t.args_schema.schema() if t.args_schema else {}
        schemas.append({
            "name": t.name,
            "description": t.description,
            "parameters": schema,
        })

    lines = [
        "=" * 60,
        "TOOL-CALLING PROTOCOL (READ CAREFULLY)",
        "=" * 60,
        "",
        "You MUST use tools to complete data requests. You CANNOT",
        "just describe what you would do — you MUST actually call the",
        "tools to fetch data and create visualizations.",
        "",
        "To call a tool, output ONLY this JSON (no markdown, no extra text):",
        "",
        '{"tool_call": {"name": "<tool_name>", "arguments": {<args>}}}',
        "",
        "MANDATORY WORKFLOW for chart/tile requests:",
        "  Step 1 → call search_metadata to find the right table",
        "  Step 2 → call execute_sql to get the data",
        "  Step 3 → call create_visualization with the data embedded in spec",
        "  Step 4 → ONLY THEN write a short confirmation message",
        "",
        "CRITICAL: After execute_sql returns rows, you MUST call",
        "create_visualization next. Do NOT describe the data in text.",
        "Do NOT say 'I have created a tile'. CALL THE TOOL.",
        "",
        "After a tool returns its result you will receive a ToolMessage.",
        "Continue calling tools until the visualization is on the dashboard.",
        "",
        "Available tools:",
        json.dumps(schemas, indent=2),
        "=" * 60,
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Response parser
# ---------------------------------------------------------------------------

def _parse_tool_call(text: str) -> dict | None:
    """Try to extract a tool_call JSON object from model output."""
    # 1. Try the whole text first (model may output only JSON)
    stripped = text.strip()
    try:
        data = json.loads(stripped)
        if "tool_call" in data:
            return data["tool_call"]
    except Exception:
        pass

    # 2. Use LangChain's robust markdown JSON parser and repair utility
    try:
        from langchain_core.utils.json import parse_json_markdown
        res = parse_json_markdown(text)
        if isinstance(res, dict) and "tool_call" in res:
            return res["tool_call"]
    except Exception as e:
        logger.debug("[LLM] parse_json_markdown failed: %s", e)
        
    # 3. If that failed but there's an obvious tool_call block, try one more time
    match = re.search(r'\{\s*"tool_call"\s*:', text)
    if match:
        start_index = match.start()
        try:
            from langchain_core.utils.json import parse_json_markdown
            res = parse_json_markdown(text[start_index:])
            if isinstance(res, dict) and "tool_call" in res:
                return res["tool_call"]
        except Exception:
            pass

    return None


def _build_ai_message(text: str) -> AIMessage:
    """Convert raw model text → AIMessage, promoting tool_calls if present."""
    tc = _parse_tool_call(text)
    if tc:
        tool_call_id = str(uuid.uuid4())
        name = tc.get("name", "")
        args = tc.get("arguments", {})
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except Exception:
                args = {}
        logger.info("[LLM] parsed tool_call: name=%s  args_keys=%s", name, list(args.keys()))
        return AIMessage(
            content="",
            tool_calls=[{
                "id": tool_call_id,
                "name": name,
                "args": args,
            }],
        )
    logger.info("[LLM] plain text response (len=%d)", len(text))
    return AIMessage(content=text)


# ---------------------------------------------------------------------------
# AccentureChatModel
# ---------------------------------------------------------------------------

class AccentureChatModel(BaseChatModel):
    """LangChain BaseChatModel backed by the Accenture GenAI gateway."""

    client: Any = None

    # We store bound tools on the instance via object.__setattr__ to avoid
    # Pydantic conflicts with arbitrary types.
    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        object.__setattr__(self, "_bound_tools_list", [])
        object.__setattr__(self, "client", AccentureGenAIClient())

    # ------------------------------------------------------------------
    # bind_tools  — emulated via prompt injection
    # ------------------------------------------------------------------

    def bind_tools(
        self,
        tools: Sequence,
        **kwargs: Any,
    ) -> "AccentureChatModel":
        """Return a copy of this model with tools injected into the system prompt."""
        clone = AccentureChatModel()
        object.__setattr__(clone, "_bound_tools_list", list(tools))
        return clone

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def _bound_tools(self) -> list:
        return object.__getattribute__(self, "_bound_tools_list")

    def _inject_tool_prompt(self, system_prompt: str) -> str:
        """Append tool schema block to the system prompt when tools are bound."""
        if not self._bound_tools:
            return system_prompt
        tool_block = _tool_schema_block(self._bound_tools)
        return f"{system_prompt}\n\n{tool_block}" if system_prompt else tool_block

    @property
    def _llm_type(self) -> str:
        return "accenture-genai"

    # ------------------------------------------------------------------
    # Sync path  (used by LangGraph .invoke())
    # ------------------------------------------------------------------

    def _generate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> ChatResult:
        system_prompt, examples, final_question = self._parse_messages(messages)
        system_prompt = self._inject_tool_prompt(system_prompt)

        response_text = self.client.chat_sync(
            question=final_question,
            system_prompt=system_prompt or None,
            examples=examples or None,
        )

        return ChatResult(
            generations=[ChatGeneration(message=_build_ai_message(response_text))]
        )

    # ------------------------------------------------------------------
    # Async path  (used by LangGraph .ainvoke() / .astream())
    # ------------------------------------------------------------------

    async def _agenerate(
        self,
        messages: List[BaseMessage],
        stop: Optional[List[str]] = None,
        **kwargs: Any,
    ) -> ChatResult:
        system_prompt, examples, final_question = self._parse_messages(messages)
        system_prompt = self._inject_tool_prompt(system_prompt)

        response_text = await self.client.chat(
            system_prompt=system_prompt,
            user_message=final_question,
            examples=examples,
        )

        return ChatResult(
            generations=[ChatGeneration(message=_build_ai_message(response_text))]
        )

    # ------------------------------------------------------------------
    # Message parsing — converts LangChain message list into the
    # Accenture API format: (system_prompt, examples, final_question)
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_messages(
        messages: List[BaseMessage],
    ) -> tuple[str, list[dict[str, str]], str]:
        """Extract system prompt, conversation examples, and the final question.

        Each (human, ai) pair becomes one example entry.
        ToolMessage results are injected into the AI turn that called them,
        so the model sees: call → result → next call decisions clearly.

        Returns:
            (system_prompt, examples, final_question)
        """
        system_prompt = ""
        examples: list[dict[str, str]] = []

        # ── 1. Extract system message ─────────────────────────────────
        for msg in messages:
            if isinstance(msg, SystemMessage):
                system_prompt = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                break

        # ── 2. Walk all non-system messages and pair them up ──────────
        # We accumulate a "pending human" turn. When we see an AIMessage
        # (tool call OR text), we close the pair. ToolMessages are appended
        # to the previous AI response so the model sees the full chain.

        # Build a map: tool_call_id → tool_name from AIMessages
        tc_name_map: dict[str, str] = {}
        for msg in messages:
            if isinstance(msg, AIMessage) and msg.tool_calls:
                for tc in msg.tool_calls:
                    tc_name_map[tc["id"]] = tc["name"]

        pending_human: str | None = None
        pending_ai_parts: list[str] = []

        def _flush() -> None:
            """Close the current pair into examples."""
            if pending_human is not None:
                ai_text = "\n".join(pending_ai_parts) if pending_ai_parts else ""
                examples.append({"user_input": pending_human, "ai_output": ai_text})

        for msg in messages:
            if isinstance(msg, SystemMessage):
                continue

            if isinstance(msg, HumanMessage):
                # New human turn → flush previous pair first
                if pending_human is not None:
                    _flush()
                    pending_ai_parts = []
                content = msg.content if isinstance(msg.content, str) else str(msg.content)
                pending_human = content

            elif isinstance(msg, AIMessage):
                # Serialize tool calls as JSON so the model sees what it called
                if msg.tool_calls:
                    for tc in msg.tool_calls:
                        tc_json = json.dumps({
                            "tool_call": {
                                "name": tc["name"],
                                "arguments": tc.get("args", {}),
                            }
                        })
                        pending_ai_parts.append(tc_json)
                elif msg.content:
                    content = (
                        msg.content if isinstance(msg.content, str) else str(msg.content)
                    )
                    pending_ai_parts.append(content)

            elif isinstance(msg, ToolMessage):
                # Inject tool result into the active AI-side narration
                tool_name = (
                    msg.name
                    or tc_name_map.get(msg.tool_call_id, "tool")
                )
                result_content = (
                    msg.content if isinstance(msg.content, str) else str(msg.content)
                )
                pending_ai_parts.append(
                    f"[Tool result from {tool_name}]: {result_content}"
                )

        # The very last human message becomes the final_question (not an example)
        final_question = ""
        if pending_human is not None:
            if not pending_ai_parts:
                final_question = pending_human
            else:
                scratchpad = "\n".join(pending_ai_parts)
                final_question = (
                    f"{pending_human}\n\n"
                    f"--- Active Tool Execution History ---\n"
                    f"{scratchpad}\n\n"
                    f"Carefully review the tool history above. You MUST NOT repeat a failed or redundant tool call. Output the NEXT logical tool call or the final answer."
                )
        else:
            for msg in reversed(messages):
                if isinstance(msg, HumanMessage):
                    final_question = (
                        msg.content if isinstance(msg.content, str) else str(msg.content)
                    )
                    break

        return system_prompt, examples, final_question
