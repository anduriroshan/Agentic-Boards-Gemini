import { create } from "zustand";
import type { Message } from "@/types/chat";
import { sendChatMessage } from "@/lib/api";
import { useAgentStore } from "@/stores/agentStore";

export interface SessionRecord {
  id: string;
  label: string;            // first user message
  messages: Message[];
  backendSessionId: string | null;
  createdAt: number;
}

interface ChatState {
  messages: Message[];
  sessionId: string | null;
  isStreaming: boolean;
  thinkingMessage: string | null;
  sessionHistory: SessionRecord[];
  abortController: AbortController | null;

  availableModels: string[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  fetchModels: () => Promise<void>;

  newSession: () => void;
  stopStreaming: () => void;
  sendMessage: (content: string) => Promise<void>;
  addVisualizationCallback: ((data: { vega_spec: Record<string, unknown>; tile_id: string; query_meta?: { sql: string; params: Record<string, unknown> } }) => void) | null;
  updateVisualizationCallback: ((data: { vega_spec: Record<string, unknown>; tile_id: string }) => void) | null;
  updateLayoutCallback: ((data: { layouts: { tile_id: string; x: number; y: number; w: number; h: number }[] }) => void) | null;
  dataTableCallback: ((data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[]; query_meta?: { sql: string; params: Record<string, unknown> } }) => void) | null;
  updateDataTableCallback: ((data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[] }) => void) | null;
  removeTileCallback: ((data: { tile_id: string }) => void) | null;
  updateTileTitleCallback: ((data: { tile_id: string; title: string }) => void) | null;
  updateTextCallback: ((data: { tile_id: string; markdown: string }) => void) | null;
  kpiTileCallback: ((data: { tile_id: string; title: string; value: string; subtitle: string; color: string; sparkline?: number[]; query_meta?: { sql: string; params: Record<string, unknown>; type?: "bigquery" | "databricks" } }) => void) | null;
  textTileCallback: ((data: { tile_id: string; title: string; markdown: string }) => void) | null;
  getTilesCallback: (() => { tile_id: string; title: string; type?: string; vega_spec: Record<string, unknown>; layout?: { x: number; y: number; w: number; h: number } }[]) | null;
  setVisualizationCallback: (cb: (data: { vega_spec: Record<string, unknown>; tile_id: string; query_meta?: { sql: string; params: Record<string, unknown> } }) => void) => void;
  setUpdateVisualizationCallback: (cb: (data: { vega_spec: Record<string, unknown>; tile_id: string }) => void) => void;
  setUpdateLayoutCallback: (cb: (data: { layouts: { tile_id: string; x: number; y: number; w: number; h: number }[] }) => void) => void;
  setDataTableCallback: (cb: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[]; query_meta?: { sql: string; params: Record<string, unknown> } }) => void) => void;
  setUpdateDataTableCallback: (cb: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[] }) => void) => void;
  setRemoveTileCallback: (cb: (data: { tile_id: string }) => void) => void;
  setUpdateTileTitleCallback: (cb: (data: { tile_id: string; title: string }) => void) => void;
  setUpdateTextCallback: (cb: (data: { tile_id: string; markdown: string }) => void) => void;
  setKpiTileCallback: (cb: (data: { tile_id: string; title: string; value: string; subtitle: string; color: string; sparkline?: number[]; query_meta?: { sql: string; params: Record<string, unknown>; type?: "bigquery" | "databricks" } }) => void) => void;
  setTextTileCallback: (cb: (data: { tile_id: string; title: string; markdown: string }) => void) => void;
  setGetTilesCallback: (cb: () => { tile_id: string; title: string; type?: string; vega_spec: Record<string, unknown>; layout?: { x: number; y: number; w: number; h: number } }[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sessionId: null,
  isStreaming: false,
  thinkingMessage: null,
  sessionHistory: [],
  abortController: null,
  availableModels: [],
  selectedModel: "gemini-2.5-flash",
  addVisualizationCallback: null,
  updateVisualizationCallback: null,
  updateLayoutCallback: null,
  dataTableCallback: null,
  updateDataTableCallback: null,
  removeTileCallback: null,
  updateTileTitleCallback: null,
  updateTextCallback: null,
  kpiTileCallback: null,
  textTileCallback: null,
  getTilesCallback: null,

  setSelectedModel: (model: string) => set({ selectedModel: model }),
  fetchModels: async () => {
    try {
      const res = await fetch("/api/chat/models");
      if (res.ok) {
        const data = await res.json();
        set({ availableModels: data.models || [] });
        if (data.models && data.models.length > 0) {
          // If gemini-2.5-flash is in the list, keep it as selected.
          // Otherwise, pick the first one if current selectedModel isn't in the list.
          const hasGemini25 = data.models.includes("gemini-2.5-flash");
          if (!hasGemini25 && !data.models.includes(get().selectedModel)) {
            set({ selectedModel: data.models[0] });
          } else if (hasGemini25) {
            set({ selectedModel: "gemini-2.5-flash" });
          }
        }
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    }
  },

  newSession: () => {
    const { messages, sessionId } = get();
    // abort any running stream first
    get().abortController?.abort();
    if (messages.length > 0) {
      const record: SessionRecord = {
        id: crypto.randomUUID(),
        label: messages[0]?.content?.slice(0, 60) ?? "Session",
        messages,
        backendSessionId: sessionId,
        createdAt: Date.now(),
      };
      set((s) => ({ sessionHistory: [...s.sessionHistory, record] }));
    }
    set({ messages: [], sessionId: null, thinkingMessage: null, isStreaming: false, abortController: null });
    useAgentStore.getState().newSession();
  },

  stopStreaming: () => {
    get().abortController?.abort();
    useAgentStore.getState().finishRun("error");
    set({ isStreaming: false, thinkingMessage: null, abortController: null });
  },

  setVisualizationCallback: (cb) => set({ addVisualizationCallback: cb }),
  setUpdateVisualizationCallback: (cb) => set({ updateVisualizationCallback: cb }),
  setUpdateLayoutCallback: (cb) => set({ updateLayoutCallback: cb }),
  setDataTableCallback: (cb) => set({ dataTableCallback: cb }),
  setUpdateDataTableCallback: (cb) => set({ updateDataTableCallback: cb }),
  setRemoveTileCallback: (cb) => set({ removeTileCallback: cb }),
  setUpdateTileTitleCallback: (cb) => set({ updateTileTitleCallback: cb }),
  setUpdateTextCallback: (cb) => set({ updateTextCallback: cb }),
  setKpiTileCallback: (cb) => set({ kpiTileCallback: cb }),
  setTextTileCallback: (cb) => set({ textTileCallback: cb }),
  setGetTilesCallback: (cb) => set({ getTilesCallback: cb }),

  sendMessage: async (content: string) => {
    const state = get();
    if (state.isStreaming) return;

    // Start a new agent run in agentStore
    useAgentStore.getState().startRun(content);

    const controller = new AbortController();
    set({ abortController: controller });

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: Date.now(),
    };

    set((s) => ({
      messages: [...s.messages, userMessage],
      isStreaming: true,
      thinkingMessage: "Processing your request...",
    }));

    let assistantContent = "";

    // Build context for the backend
    const currentTiles = get().getTilesCallback?.() ?? [];
    const chatHistory = get().messages.map((m) => ({ role: m.role, content: m.content }));

    try {
      await sendChatMessage(
        state.sessionId,
        content,
        {
          onThinking: (data: { message: string }) => {
            set({ thinkingMessage: data.message });
          },
          onMessage: (data: { content: string }) => {
            assistantContent += data.content;
          },
          onVisualization: (data: { vega_spec: Record<string, unknown>; tile_id: string; query_meta?: { sql: string; params: Record<string, unknown> } }) => {
            get().addVisualizationCallback?.(data);
          },
          onUpdateVisualization: (data: { vega_spec: Record<string, unknown>; tile_id: string }) => {
            get().updateVisualizationCallback?.(data);
          },
          onUpdateLayout: (data: { layouts: { tile_id: string; x: number; y: number; w: number; h: number }[] }) => {
            get().updateLayoutCallback?.(data);
          },
          onDataTable: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[]; query_meta?: { sql: string; params: Record<string, unknown> } }) => {
            get().dataTableCallback?.(data);
          },
          onUpdateDataTable: (data: { tile_id: string; title: string; columns: { field: string; headerName: string }[]; rows: Record<string, unknown>[] }) => {
            get().updateDataTableCallback?.(data);
          },
          onKpiTile: (data: { tile_id: string; title: string; value: string; subtitle: string; color: string; sparkline?: number[]; query_meta?: { sql: string; params: Record<string, unknown>; type?: "bigquery" | "databricks" } }) => {
            get().kpiTileCallback?.(data);
          },
          onTextTile: (data: { tile_id: string; title: string; markdown: string }) => {
            get().textTileCallback?.(data);
          },
          onRemoveTile: (data: { tile_id: string }) => {
            get().removeTileCallback?.(data);
          },
          onUpdateTileTitle: (data: { tile_id: string; title: string }) => {
            get().updateTileTitleCallback?.(data);
          },
          onUpdateText: (data: { tile_id: string; markdown: string }) => {
            get().updateTextCallback?.(data);
          },
          onAgentStep: (data: import("@/lib/api").AgentStepData) => {
            useAgentStore.getState().upsertStep(data);
          },
          onDone: (data: { session_id: string }) => {
            useAgentStore.getState().finishRun("done");
            const assistantMessage: Message = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: assistantContent || "Chart updated.",
              timestamp: Date.now(),
            };
            set((s) => ({
              messages: [...s.messages, assistantMessage],
              sessionId: data.session_id,
              isStreaming: false,
              thinkingMessage: null,
              abortController: null,
            }));
          },
          onError: (data: { message: string }) => {
            useAgentStore.getState().finishRun("error");
            const errorMessage: Message = {
              id: crypto.randomUUID(),
              role: "assistant",
              content: `Error: ${data.message}`,
              timestamp: Date.now(),
            };
            set((s) => ({
              messages: [...s.messages, errorMessage],
              isStreaming: false,
              thinkingMessage: null,
              abortController: null,
            }));
          },
        },
        currentTiles,
        chatHistory,
        state.selectedModel,
        useAgentStore.getState().activeConnection,
        controller.signal,
      );
    } catch (error) {
      // Treat AbortError (user stopped) silently — no error message
      if (error instanceof Error && error.name === "AbortError") {
        set({ isStreaming: false, thinkingMessage: null, abortController: null });
        return;
      }
      useAgentStore.getState().finishRun("error");
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: `Connection error: ${errorMsg}`,
        timestamp: Date.now(),
      };
      set((s) => ({
        messages: [...s.messages, errorMessage],
        isStreaming: false,
        thinkingMessage: null,
      }));
    }
  },
}));
