import type { DashboardTile } from "@/types/dashboard";
import type { Message } from "@/types/chat";

export interface SavedSession {
    id: string;
    name: string;
    dashboard: { tiles: DashboardTile[] };
    chat: { messages: Message[]; sessionId: string | null };
    tileCount: number;
    savedAt: number;
}

export async function listSessions(): Promise<SavedSession[]> {
    try {
        const res = await fetch("/api/workspaces");
        if (!res.ok) return [];
        const sessions = await res.json() as SavedSession[];
        return sessions; // already sorted descending by the backend
    } catch (err) {
        console.error("Failed to list workspaces", err);
        return [];
    }
}

export async function saveSession(session: SavedSession): Promise<void> {
    try {
        await fetch("/api/workspaces", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(session),
        });
    } catch (err) {
        console.error("Failed to save workspace", err);
    }
}

export async function loadSession(id: string): Promise<SavedSession | null> {
    // To load a specific session, we re-fetch the list (could be optimized with a GET /api/workspaces/{id} later)
    const sessions = await listSessions();
    return sessions.find((s) => s.id === id) ?? null;
}

export async function deleteSession(id: string): Promise<void> {
    try {
        await fetch(`/api/workspaces/${id}`, {
            method: "DELETE",
        });
    } catch (err) {
        console.error("Failed to delete workspace", err);
    }
}
