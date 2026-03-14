import { useEffect, useState } from "react";

interface KpiTileControlsProps {
  currentFontSize?: string;
  onApply: (fontSize: string) => void;
}

const fontSizes = [
  { label: "Small", value: "sm" },
  { label: "Normal", value: "md" },
  { label: "Large", value: "lg" },
  { label: "Extra Large", value: "xl" },
];

export default function KpiTileControls({ currentFontSize, onApply }: KpiTileControlsProps) {
  const [localSize, setLocalSize] = useState(currentFontSize || "md");

  useEffect(() => {
    setLocalSize(currentFontSize || "md");
  }, [currentFontSize]);

  return (
    <div className="px-4 py-2 border-b bg-muted/30 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">KPI Font Size</label>
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
