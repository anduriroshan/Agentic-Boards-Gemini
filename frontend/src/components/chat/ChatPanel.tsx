import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import type { SessionRecord } from "@/stores/chatStore";
import { cn } from "@/lib/utils";
import {
  Plus,
  ChevronDown,
  ChevronRight,
  Clock,
  MessageCircle,
  Send,
  StopCircle,
} from "lucide-react";

// ─── Past session viewer ─────────────────────────────────────────────────────

function SessionHistoryItem({ session }: { session: SessionRecord }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        )}
        <span className="text-xs text-gray-600 truncate flex-1">{session.label}</span>
        <span className="text-[10px] text-gray-400 shrink-0">
          {new Date(session.createdAt).toLocaleDateString([], {
            month: "short",
            day: "numeric",
          })}
        </span>
      </button>

      {open && (
        <div className="px-3 pb-2 space-y-2">
          {session.messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs max-w-[85%] w-fit",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-gray-100 text-gray-700",
                )}
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

interface ChatPanelProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export default function ChatPanel({ collapsed = false, onToggle }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    thinkingMessage,
    sendMessage,
    stopStreaming,
    newSession,
    sessionHistory,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed)
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinkingMessage, collapsed]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    setInput("");
    sendMessage(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-card overflow-hidden">
      {/* ── header — always visible, click icon+title area to collapse ── */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b shrink-0">
        {/* left: toggle button */}
        <button
          onClick={onToggle}
          className="flex items-center gap-2 flex-1 min-w-0 hover:opacity-70 transition-opacity text-left"
        >
          <MessageCircle className="w-4 h-4 text-gray-500 shrink-0" />
          <span className="text-xs font-semibold text-gray-700 tracking-wide flex-1">
            Chat
          </span>
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
          )}
        </button>

        {/* right: New Chat button — doesn't toggle collapse */}
        {!collapsed && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              newSession();
            }}
            title="New chat session"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors shrink-0 ml-1"
          >
            <Plus className="w-3.5 h-3.5" />
            New Chat
          </button>
        )}
      </div>

      {/* ── everything below is hidden when collapsed ── */}
      {!collapsed && (
        <>
          {/* session history accordion */}
          {sessionHistory.length > 0 && (
            <div className="border-b shrink-0">
              <button
                onClick={() => setHistoryOpen((o) => !o)}
                className="w-full flex items-center gap-2 px-4 py-2 text-left hover:bg-muted/40 transition-colors"
              >
                <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-xs text-muted-foreground flex-1">
                  Past sessions ({sessionHistory.length})
                </span>
                {historyOpen ? (
                  <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
                )}
              </button>

              {historyOpen && (
                <div className="max-h-48 overflow-y-auto bg-gray-50/50">
                  {sessionHistory.map((s) => (
                    <SessionHistoryItem key={s.id} session={s} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* current messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-muted-foreground text-sm mt-8">
                <p>Ask the agent to create a visualization.</p>
                <p className="mt-2 text-xs">
                  Try: "Show me a bar chart of sales by category"
                </p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm max-w-[85%] w-fit",
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  {msg.content}
                </div>
              </div>
            ))}

            {thinkingMessage && (
              <p className="text-xs text-muted-foreground italic animate-pulse">
                {thinkingMessage}
              </p>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* input row */}
          <div className="border-t p-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask the agent..."
                disabled={isStreaming}
                rows={1}
                className="flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              />

              {isStreaming ? (
                /* Stop button */
                <button
                  onClick={stopStreaming}
                  title="Stop agent"
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-red-50 hover:bg-red-100 border border-red-200 transition-colors"
                >
                  <StopCircle className="w-4 h-4 text-red-500" />
                </button>
              ) : (
                /* Send button */
                <button
                  onClick={handleSend}
                  disabled={!input.trim()}
                  title="Send"
                  className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-4 h-4 text-primary-foreground" />
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
