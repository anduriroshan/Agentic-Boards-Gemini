import { create } from "zustand";
import type { SavedSession } from "@/lib/sessionStorage";
import {
    listSessions,
    saveSession as persistSession,
    deleteSession as removeSession,
} from "@/lib/sessionStorage";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useChatStore } from "@/stores/chatStore";

interface SessionState {
    sessions: SavedSession[];
    activeSessionId: string | null;
    activeSessionName: string | null;
    isLoading: boolean;
    refresh: () => Promise<void>;
    save: (name?: string) => Promise<void>;
    load: (id: string) => Promise<void>;
    remove: (id: string) => Promise<void>;
    clearActive: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
    sessions: [],
    activeSessionId: null,
    activeSessionName: null,
    isLoading: false,

    refresh: async () => {
        set({ isLoading: true });
        try {
            const sessions = await listSessions();
            set({ sessions });
        } finally {
            set({ isLoading: false });
        }
    },

    save: async (name?: string) => {
        const { activeSessionId, activeSessionName } = get();
        const tiles = useDashboardStore.getState().tiles;
        const { messages, sessionId } = useChatStore.getState();

        const finalName = name || activeSessionName || "Untitled Session";
        const finalId = activeSessionId || crypto.randomUUID();

        const session: SavedSession = {
            id: finalId,
            name: finalName,
            dashboard: { tiles },
            chat: { messages, sessionId },
            tileCount: tiles.length,
            savedAt: Date.now(),
        };

        await persistSession(session);
        const sessions = await listSessions();
        set({
            sessions,
            activeSessionId: finalId,
            activeSessionName: finalName
        });
    },

    load: async (id: string) => {
        const sessions = await listSessions();
        const session = sessions.find((s) => s.id === id);
        if (!session) return;

        set({ activeSessionId: session.id, activeSessionName: session.name });

        // Restore dashboard
        const dashStore = useDashboardStore.getState();
        dashStore.clearDashboard();
        for (const tile of session.dashboard.tiles) {
            if (tile.type === "table" && tile.tableData) {
                dashStore.addTableTile(tile.id, tile.tableData, tile.title, tile.queryMeta);
            } else if (tile.type === "text" && tile.textData) {
                dashStore.addTextTile(tile.id, tile.textData.markdown, tile.title, tile.textData.fontSize);
            } else if (tile.type === "kpi" && tile.kpiData) {
                dashStore.addKpiTile(tile.id, tile.kpiData, tile.title, tile.queryMeta);
            } else if (tile.vegaSpec) {
                dashStore.addTile(tile.id, tile.vegaSpec, tile.title, tile.queryMeta);
            }
            // Restore the saved layout position (addTile auto-generates a new one)
            dashStore.updateTileLayouts([{
                tile_id: tile.id,
                x: tile.layout.x,
                y: tile.layout.y,
                w: tile.layout.w,
                h: tile.layout.h,
            }]);
        }

        // Restore chat (use internal set via store API)
        useChatStore.setState({
            messages: session.chat.messages,
            sessionId: session.chat.sessionId,
        });
    },

    remove: async (id: string) => {
        const { activeSessionId } = get();
        await removeSession(id);
        const sessions = await listSessions();
        const updates: any = { sessions };
        if (activeSessionId === id) {
            updates.activeSessionId = null;
            updates.activeSessionName = null;
        }
        set(updates);
    },

    clearActive: () => {
        set({ activeSessionId: null, activeSessionName: null });
    },
}));
