import { useState, useRef, useEffect } from "react";
import { useSessionStore } from "@/stores/sessionStore";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useChatStore } from "@/stores/chatStore";
import { Save, FolderOpen, Trash2, X, Download } from "lucide-react";

export default function SessionsPanel() {
    const { sessions, activeSessionId, activeSessionName, refresh, save, load, remove, clearActive } = useSessionStore();
    const tiles = useDashboardStore((s) => s.tiles);

    const [isOpen, setIsOpen] = useState(false);
    const [saveName, setSaveName] = useState("");
    const [showSaveInput, setShowSaveInput] = useState(false);
    const [confirmLoadId, setConfirmLoadId] = useState<string | null>(null);
    const panelRef = useRef<HTMLDivElement>(null);

    // Refresh list when opening
    useEffect(() => {
        if (isOpen) refresh();
    }, [isOpen, refresh]);

    // Click outside to close
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                setIsOpen(false);
                setShowSaveInput(false);
                setConfirmLoadId(null);
            }
        };
        document.addEventListener("mousedown", handler);
        return () => document.removeEventListener("mousedown", handler);
    }, [isOpen]);

    const handleSave = () => {
        const name = saveName.trim();
        if (!name && !activeSessionId) return;
        save(name || undefined);
        setSaveName("");
        setShowSaveInput(false);
    };

    const handleLoad = (id: string) => {
        // If dashboard has tiles, confirm first
        if (tiles.length > 0 && confirmLoadId !== id) {
            setConfirmLoadId(id);
            return;
        }
        load(id);
        setConfirmLoadId(null);
        setIsOpen(false);
    };

    return (
        <div className="relative" ref={panelRef}>
            {/* Toggle buttons */}
            <div className="flex items-center gap-1">
                {activeSessionId ? (
                    <button
                        onClick={() => save()}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                        title={`Update "${activeSessionName}"`}
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Update</span>
                    </button>
                ) : (
                    <button
                        onClick={() => {
                            if (tiles.length === 0) return;
                            setIsOpen(true);
                            setShowSaveInput(true);
                        }}
                        disabled={tiles.length === 0}
                        className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Save current session"
                    >
                        <Save className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Save</span>
                    </button>
                )}

                <button
                    onClick={() => {
                        setIsOpen(!isOpen);
                        setShowSaveInput(false);
                        setConfirmLoadId(null);
                    }}
                    className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium border hover:bg-muted transition-colors"
                    title="Saved sessions"
                >
                    <FolderOpen className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">
                        {activeSessionName ? activeSessionName : "Sessions"}
                    </span>
                    {sessions.length > 0 && (
                        <span className="bg-primary/10 text-primary text-[10px] px-1.5 rounded-full">
                            {sessions.length}
                        </span>
                    )}
                </button>
            </div>

            {/* Dropdown panel */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 z-50 w-80 rounded-lg border bg-card shadow-lg">
                    <div className="p-3 space-y-3">
                        {/* Header */}
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-foreground">
                                Sessions
                            </h3>
                            <button
                                onClick={() => { setIsOpen(false); setShowSaveInput(false); }}
                                className="text-muted-foreground hover:text-foreground text-lg leading-none"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Save input */}
                        {showSaveInput && (
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={saveName}
                                    onChange={(e) => setSaveName(e.target.value)}
                                    onKeyDown={(e) => e.key === "Enter" && handleSave()}
                                    placeholder="Session name…"
                                    autoFocus
                                    className="flex-1 rounded-md border bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <button
                                    onClick={handleSave}
                                    disabled={!saveName.trim() && !activeSessionId}
                                    className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                >
                                    {activeSessionId ? "Update" : "Save"}
                                </button>
                            </div>
                        )}

                        {!showSaveInput && (
                            <div className="flex gap-2">
                                {tiles.length > 0 && (
                                    <button
                                        onClick={() => setShowSaveInput(true)}
                                        className="flex-1 flex items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
                                    >
                                        <Save className="w-3.5 h-3.5" />
                                        {activeSessionId ? "Update session" : "Save dashboard"}
                                    </button>
                                )}
                                {activeSessionId && (
                                    <button
                                        onClick={() => {
                                            clearActive();
                                            useDashboardStore.getState().clearDashboard();
                                            useChatStore.setState({ messages: [], sessionId: null });
                                            setIsOpen(false);
                                        }}
                                        className="flex items-center justify-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-red-500 hover:border-red-500/30 transition-colors"
                                        title="Start new session"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                        New
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Session list */}
                        {sessions.length === 0 ? (
                            <p className="text-xs text-muted-foreground text-center py-4">
                                No saved sessions yet
                            </p>
                        ) : (
                            <div className="max-h-64 overflow-y-auto space-y-1">
                                {sessions.map((s) => (
                                    <div
                                        key={s.id}
                                        className="group flex items-center gap-2 rounded-md px-2.5 py-2 hover:bg-muted/50 transition-colors"
                                    >
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium text-foreground truncate">
                                                {s.name}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {s.tileCount} tile{s.tileCount !== 1 ? "s" : ""} · {new Date(s.savedAt).toLocaleDateString([], {
                                                    month: "short",
                                                    day: "numeric",
                                                    hour: "2-digit",
                                                    minute: "2-digit",
                                                })}
                                            </p>
                                        </div>

                                        {confirmLoadId === s.id ? (
                                            <div className="flex items-center gap-1 shrink-0">
                                                <span className="text-[10px] text-amber-600">Replace?</span>
                                                <button
                                                    onClick={() => handleLoad(s.id)}
                                                    className="text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                                                >
                                                    Yes
                                                </button>
                                                <button
                                                    onClick={() => setConfirmLoadId(null)}
                                                    className="text-[10px] px-1.5 py-0.5 rounded border hover:bg-muted"
                                                >
                                                    No
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => handleLoad(s.id)}
                                                    className="p-1 rounded hover:bg-primary/10 text-primary"
                                                    title="Load session"
                                                >
                                                    <Download className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => remove(s.id)}
                                                    className="p-1 rounded hover:bg-destructive/10 text-destructive"
                                                    title="Delete session"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
