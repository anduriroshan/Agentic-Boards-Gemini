import type { DashboardTile } from "@/types/dashboard";
import type { Message } from "@/types/chat";

const STORAGE_KEY = "agentic_boards_sessions";

export interface SavedSession {
    id: string;
    name: string;
    dashboard: { tiles: DashboardTile[] };
    chat: { messages: Message[]; sessionId: string | null };
    tileCount: number;
    savedAt: number;
}

export function listSessions(): SavedSession[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const sessions = JSON.parse(raw) as SavedSession[];
        return sessions.sort((a, b) => b.savedAt - a.savedAt);
    } catch {
        return [];
    }
}

export function saveSession(session: SavedSession): void {
    const sessions = listSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) {
        sessions[idx] = session;
    } else {
        sessions.unshift(session);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function loadSession(id: string): SavedSession | null {
    const sessions = listSessions();
    return sessions.find((s) => s.id === id) ?? null;
}

export function deleteSession(id: string): void {
    const sessions = listSessions().filter((s) => s.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}
