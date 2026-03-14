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
  Mic,
} from "lucide-react";
import LiveAgent from "./LiveAgent";

// ─── Past session viewer ─────────────────────────────────────────────────────

function SessionHistoryItem({ session }: { session: SessionRecord }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-gray-100 last:border-0 text-gray-800">
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
                  "rounded-2xl px-3 py-1.5 text-xs max-w-[85%] w-fit",
                  msg.role === "user"
                    ? "bg-purple-600 text-white rounded-tr-none"
                    : "bg-gray-200 text-gray-800 rounded-tl-none",
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
    availableModels,
    selectedModel,
    setSelectedModel,
    fetchModels,
  } = useChatStore();

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const [input, setInput] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "live">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed && activeTab === "chat")
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinkingMessage, collapsed, activeTab]);

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
    <div className="h-full flex flex-col bg-white text-gray-800 overflow-hidden relative border rounded-xl shadow-sm mx-1 my-1">
      {/* HEADER SECTION - TABS MOCKUP STYLE */}
      <div className="flex h-[56px] items-center justify-between px-3 border-b shrink-0 select-none z-20">
        <div className="flex items-center gap-1">
          {/* Chat Tab */}
          <button 
            onClick={() => setActiveTab("chat")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all",
              activeTab === "chat" ? "bg-purple-600 text-white shadow-md font-bold" : "text-gray-500 hover:bg-gray-100 font-medium"
            )}
          >
            <MessageCircle className="w-4 h-4" />
            <span className="text-sm">Chat</span>
          </button>

          {/* Live Tab */}
          <button 
            onClick={() => setActiveTab("live")}
            className={cn(
              "flex items-center gap-2 px-3 py-1.5 rounded-xl transition-all",
              activeTab === "live" ? "bg-purple-600 text-white shadow-md font-bold" : "text-gray-500 hover:bg-gray-100 font-medium"
            )}
          >
            <Mic className="w-4 h-4" />
            <span className="text-sm">Live</span>
          </button>
        </div>

        {!collapsed && (
          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
             {/* Model Selector - RESTORED */}
             {availableModels.length > 0 && activeTab === "chat" && (
                <select
                  className="text-[10px] bg-white text-gray-600 border border-gray-200 rounded px-1.5 py-0.5 outline-none cursor-pointer hover:border-blue-400 transition-colors max-w-[80px] truncate"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  title="Select LLM Model"
                >
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              )}

            <button
              onClick={newSession}
              className="flex items-center gap-1.5 px-3 py-1 bg-gray-200 text-gray-700 hover:bg-gray-300 rounded-full text-[11px] font-bold transition-all shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              New Chat
            </button>
            <button onClick={onToggle} className="p-1 hover:bg-gray-100 rounded lg:hidden">
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>
          </div>
        )}
      </div>

      {/* BODY CONTENT - MUTUALLY EXCLUSIVE TABS */}
      {!collapsed && (
        <div className="flex-1 flex flex-col min-h-0 relative bg-white">
          {activeTab === "live" ? (
            /* LIVE MODE VIEW - RENDER THE REAL COMPONENT */
            <div className="flex-1 overflow-hidden">
               <LiveAgent />
            </div>
          ) : (
            /* CHAT MODE VIEW */
            <>
              {/* HISTORY ACCORDION */}
              <div className="px-3 py-2">
                <button
                  onClick={() => setHistoryOpen((o) => !o)}
                  className="w-full flex items-center gap-2 px-4 py-2 bg-gray-200/50 hover:bg-gray-200 rounded-xl transition-colors"
                >
                  <Clock className="w-4 h-4 text-gray-500" />
                  <span className="text-xs text-gray-700 flex-1 font-semibold text-left">
                    Past sessions
                  </span>
                  <ChevronRight className={cn("w-4 h-4 text-gray-400 transition-transform", historyOpen && "rotate-90")} />
                </button>
                {historyOpen && (
                  <div className="mt-1 border border-gray-100 rounded-xl overflow-hidden shadow-inner">
                    {sessionHistory.map((s) => (
                      <SessionHistoryItem key={s.id} session={s} />
                    ))}
                  </div>
                )}
              </div>

              {/* MESSAGES LIST */}
              <div className="flex-1 overflow-y-auto px-4 py-2 space-y-4">
                {messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-300 opacity-50 py-10">
                    <MessageCircle className="w-12 h-12" />
                    <p className="text-sm font-medium">Start the conversation</p>
                  </div>
                )}
                
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}
                  >
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-2.5 text-[13px] max-w-[85%] w-fit shadow-sm",
                        msg.role === "user"
                          ? "bg-purple-600 text-white rounded-tr-sm"
                          : "bg-gray-100 text-gray-800 rounded-tl-sm border border-gray-200",
                      )}
                    >
                      {msg.content}
                    </div>
                  </div>
                ))}
                
                {thinkingMessage && (
                  <p className="text-[11px] text-gray-400 italic animate-pulse">
                    loading text
                  </p>
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* INPUT AREA */}
              <div className="p-4 bg-white border-t shrink-0">
                <div className="relative flex items-center gap-2 bg-white border border-gray-300 rounded-[32px] px-4 py-2 shadow-sm focus-within:ring-2 focus-within:ring-purple-600/20 focus-within:border-purple-600 transition-all">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Message the agent..."
                    disabled={isStreaming}
                    rows={1}
                    className="flex-1 min-h-[24px] max-h-[120px] resize-none bg-transparent py-1 text-sm outline-none placeholder:text-gray-400"
                  />
                  <div className="flex items-center gap-2">
                    {isStreaming ? (
                      <button
                        onClick={stopStreaming}
                        className="p-1 rounded-full text-purple-600 hover:bg-purple-50 transition-colors"
                      >
                        <StopCircle className="w-5 h-5" />
                      </button>
                    ) : (
                      <button
                        disabled={!input.trim()}
                        onClick={handleSend}
                        className="p-1 rounded-full text-purple-600 hover:bg-purple-50 active:scale-90 disabled:opacity-30 disabled:grayscale transition-all"
                      >
                        <Send className="w-6 h-6 rotate-45" />
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-[9px] text-center text-gray-400 mt-2">
                  Gemini can make mistakes. Check important info.
                </p>
              </div>
            </>
          )}
        </div>
      )}

      {/* Collapsed view toggle button */}
      {collapsed && (
        <button onClick={onToggle} className="flex-1 flex items-center justify-center hover:bg-gray-50 transition-colors py-4">
          <ChevronRight className="w-5 h-5 text-gray-400" />
        </button>
      )}
    </div>
  );
}
