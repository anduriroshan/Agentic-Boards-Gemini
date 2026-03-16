import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import { type TextData } from "@/types/dashboard";

interface TextTileProps {
    data: TextData;
    onUpdate?: (newMarkdown: string) => void;
}

export default function TextTile({ data, onUpdate }: TextTileProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState(data.markdown);

    const handleSave = () => {
        setIsEditing(false);
        if (draft !== data.markdown && onUpdate) {
            onUpdate(draft);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            handleSave();
        }
        if (e.key === "Escape") {
            setDraft(data.markdown);
            setIsEditing(false);
        }
    };

    if (isEditing) {
        return (
            <div className="flex flex-col h-full w-full p-2 bg-background/50 rounded animate-in fade-in duration-200">
                <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className="flex-1 w-full resize-none bg-transparent outline-none p-2 font-mono text-sm leading-relaxed"
                    placeholder="Type markdown here..."
                />
                <div className="flex justify-between items-center px-2 pt-2 border-t border-border/40 mt-1">
                    <span className="text-[10px] text-muted-foreground">Cmd/Ctrl + Enter to save, Esc to cancel</span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setDraft(data.markdown);
                                setIsEditing(false);
                            }}
                            className="text-xs px-2 py-1 hover:bg-muted text-muted-foreground rounded transition"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            className="text-xs px-3 py-1 bg-primary text-primary-foreground font-medium rounded shadow hover:bg-primary/90 transition"
                        >
                            Save
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div
            className={`h-full w-full overflow-y-auto p-4 group cursor-text ${data.fontSize || 'text-sm'} text-foreground/90 leading-relaxed`}
            onClick={() => setIsEditing(true)}
        >
            {data.markdown ? (
                <div className="prose prose-sm prose-headings:font-bold prose-h1:text-2xl prose-h1:mt-5 prose-h1:mb-3 prose-h2:text-xl prose-h2:mt-4 prose-h2:mb-2 prose-h3:text-lg prose-h3:mt-3 prose-h3:mb-1 prose-strong:font-bold prose-em:italic prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-code:font-mono prose-code:text-primary prose-blockquote:border-l-4 prose-blockquote:border-primary/50 prose-blockquote:pl-4 prose-blockquote:py-1 prose-blockquote:my-2 prose-blockquote:text-muted-foreground prose-blockquote:italic prose-li:ml-4 prose-li:list-disc max-w-none">
                    <ReactMarkdown rehypePlugins={[rehypeSanitize]}>
                        {data.markdown}
                    </ReactMarkdown>
                </div>
            ) : (
                <div className="h-full w-full flex items-center justify-center text-muted-foreground italic opacity-50">
                    Empty notes—click to edit
                </div>
            )}
            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 bg-background/80 backdrop-blur rounded p-1 text-[10px] text-muted-foreground transition pointer-events-none">
                Click to edit
            </div>
        </div>
    );
}
