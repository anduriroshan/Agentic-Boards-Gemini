import React, { useState } from "react";
import { type TextData } from "@/types/dashboard";

// Very minimal inline markdown parser for simple bold/italic/links/headings/lists
function parseMarkdown(text: string) {
    let html = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    // Headings
    html = html.replace(/^### (.*$)/gim, '<h3 class="text-lg font-bold mt-3 mb-1">$1</h3>');
    html = html.replace(/^## (.*$)/gim, '<h2 class="text-xl font-bold mt-4 mb-2">$1</h2>');
    html = html.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-5 mb-3">$1</h1>');

    // Bold and Italic
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // Code
    html = html.replace(/`(.*?)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono text-primary">$1</code>');

    // Blockquotes
    html = html.replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-primary/50 pl-4 py-1 my-2 text-muted-foreground italic">$1</blockquote>');

    // Bullet Lists
    html = html.replace(/^\* (.*$)/gim, '<li class="ml-4 list-disc marker:text-primary">$1</li>');
    html = html.replace(/^- (.*$)/gim, '<li class="ml-4 list-disc marker:text-primary">$1</li>');

    // Line breaks
    html = html.replace(/\n\n/g, '<br/><br/>');
    html = html.replace(/\n(?!(<\/li>|<\/h|<br|\s*$))/g, '<br/>');

    return { __html: html };
}

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
                <div dangerouslySetInnerHTML={parseMarkdown(data.markdown)} />
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
