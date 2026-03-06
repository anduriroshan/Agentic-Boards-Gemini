import { useState } from "react";
import { useDashboardStore } from "@/stores/dashboardStore";
import type { Comment } from "@/types/dashboard";

interface TileCommentsProps {
    tileId: string;
    comments: Comment[];
}

export default function TileComments({ tileId, comments }: TileCommentsProps) {
    const { addComment, deleteComment } = useDashboardStore();
    const [newText, setNewText] = useState("");

    const handleAdd = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newText.trim()) return;
        addComment(tileId, newText.trim());
        setNewText("");
    };

    return (
        <div className="flex flex-col border-b border-border bg-muted/40 max-h-48 overflow-y-auto">
            {/* Existing Comments List */}
            <div className="flex flex-col gap-1 p-2">
                {comments.length === 0 ? (
                    <div className="text-xs text-muted-foreground italic px-2 py-1">
                        No comments yet.
                    </div>
                ) : (
                    comments.map((c) => (
                        <div
                            key={c.id}
                            className="group relative flex flex-col gap-0.5 rounded bg-background p-2 text-sm shadow-sm border border-border/50"
                        >
                            <div className="flex items-center justify-between">
                                <span className="font-semibold text-xs text-foreground/80">{c.author}</span>
                                <span className="text-[10px] text-muted-foreground">
                                    {new Date(c.createdAt).toLocaleDateString()}
                                </span>
                            </div>
                            <p className="text-foreground/90 whitespace-pre-wrap">{c.text}</p>

                            <button
                                onClick={() => deleteComment(tileId, c.id)}
                                className="absolute right-1 top-1 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:bg-destructive/10 p-1 rounded"
                                title="Delete comment"
                            >
                                &times;
                            </button>
                        </div>
                    ))
                )}
            </div>

            {/* Add New Comment Form */}
            <form onSubmit={handleAdd} className="flex gap-2 p-2 border-t border-border/50 bg-background/50">
                <input
                    type="text"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                    placeholder="Add a note..."
                    className="flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <button
                    type="submit"
                    disabled={!newText.trim()}
                    className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                    Post
                </button>
            </form>
        </div>
    );
}
