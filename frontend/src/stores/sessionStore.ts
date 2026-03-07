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
    refresh: () => void;
    save: (name: string) => void;
    load: (id: string) => void;
    remove: (id: string) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
    sessions: listSessions(),

    refresh: () => set({ sessions: listSessions() }),

    save: (name: string) => {
        const tiles = useDashboardStore.getState().tiles;
        const { messages, sessionId } = useChatStore.getState();

        const session: SavedSession = {
            id: crypto.randomUUID(),
            name,
            dashboard: { tiles },
            chat: { messages, sessionId },
            tileCount: tiles.length,
            savedAt: Date.now(),
        };

        persistSession(session);
        set({ sessions: listSessions() });
    },

    load: (id: string) => {
        const sessions = listSessions();
        const session = sessions.find((s) => s.id === id);
        if (!session) return;

        // Restore dashboard
        const dashStore = useDashboardStore.getState();
        dashStore.clearDashboard();
        for (const tile of session.dashboard.tiles) {
            if (tile.type === "table" && tile.tableData) {
                dashStore.addTableTile(tile.id, tile.tableData, tile.title, tile.queryMeta);
            } else if (tile.type === "text" && tile.textData) {
                dashStore.addTextTile(tile.id, tile.textData.markdown, tile.title, tile.textData.fontSize);
            } else if (tile.type === "kpi" && tile.kpiData) {
                dashStore.addKpiTile(tile.id, tile.kpiData, tile.title);
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

    remove: (id: string) => {
        removeSession(id);
        set({ sessions: listSessions() });
    },
}));
