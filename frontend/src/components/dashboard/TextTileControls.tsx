import { useState, useEffect } from "react";

interface TextTileControlsProps {
    currentFontSize?: string;
    onApply: (fontSize: string) => void;
}

const fontSizes = [
    { label: "Extra Small", value: "text-xs" },
    { label: "Small", value: "text-sm" },
    { label: "Normal", value: "text-base" },
    { label: "Large", value: "text-lg" },
    { label: "X-Large", value: "text-xl" },
    { label: "2X-Large", value: "text-2xl" },
];

export default function TextTileControls({ currentFontSize, onApply }: TextTileControlsProps) {
    const [localSize, setLocalSize] = useState(currentFontSize || "text-sm");

    useEffect(() => {
        setLocalSize(currentFontSize || "text-sm");
    }, [currentFontSize]);

    return (
        <div className="px-4 py-2 border-b bg-muted/30 text-sm">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1">
                    <label className="text-xs text-muted-foreground font-medium">
                        Font Size
                    </label>
                    <select
                        value={localSize}
                        className="px-2 py-1 border rounded text-sm bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                        onChange={(e) => {
                            const newSize = e.target.value;
                            setLocalSize(newSize);
                            onApply(newSize);
                        }}
                    >
                        {fontSizes.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                                {opt.label}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
        </div>
    );
}
