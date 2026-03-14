import type { KpiData } from "@/types/dashboard";

interface KpiTileProps {
    title: string;
    kpiData: KpiData;
}

/** Format a raw numeric string with commas if it's a pure number. */
function formatValue(raw: string): string {
    const trimmed = raw.trim();
    // Allow optional leading $ or % suffix / prefix
    const match = trimmed.match(/^([^\d]*)(\d[\d,.]*)([^\d]*)$/);
    if (!match) return raw;
    const prefix = match[1] ?? "";
    const num = match[2];
    const suffix = match[3] ?? "";
    if (!num) return raw;
    const plain = num.replace(/,/g, "");
    const parsed = parseFloat(plain);
    if (isNaN(parsed)) return raw;
    const formatted = parsed.toLocaleString("en-US", {
        minimumFractionDigits: plain.includes(".") ? 2 : 0,
        maximumFractionDigits: 2,
    });
    return `${prefix}${formatted}${suffix}`;
}

export default function KpiTile({ title, kpiData }: KpiTileProps) {
    const { value, subtitle, color, sparkline, fontSize } = kpiData;
    const displayValue = formatValue(value);
    const valueColor = color || "#1e40af"; // default deep-blue
    const size = fontSize || "md";
    const valueFontSize =
        size === "sm"
            ? "clamp(1.2rem, 3vw, 2.1rem)"
            : size === "lg"
                ? "clamp(2rem, 5vw, 3.2rem)"
                : size === "xl"
                    ? "clamp(2.3rem, 5.6vw, 3.8rem)"
                    : "clamp(1.6rem, 4vw, 2.8rem)";
    const labelFontSize =
        size === "sm" ? "0.62rem" : size === "lg" ? "0.84rem" : size === "xl" ? "0.96rem" : "0.72rem";
    const subtitleFontSize =
        size === "sm" ? "0.62rem" : size === "lg" ? "0.82rem" : size === "xl" ? "0.9rem" : "0.7rem";

    // Calculate sparkline path if data exists
    let sparklinePath = "";
    let sparklineColor = "#94a3b8"; // default gray
    if (sparkline && sparkline.length > 1) {
        const min = Math.min(...sparkline);
        const max = Math.max(...sparkline);
        const range = max - min || 1; // avoid div/0

        // Config for SVG viewBox
        const width = 100;
        const height = 30;

        const points = sparkline.map((val, i) => {
            const x = (i / (sparkline.length - 1)) * width;
            // y is inverted (SVG 0 is top)
            const y = height - ((val - min) / range) * height;
            return `${x},${y}`;
        });

        // Build actual path
        sparklinePath = `M ${points.join(" L ")}`;

        // Determine trend color
        const first = sparkline[0] ?? 0;
        const last = sparkline[sparkline.length - 1] ?? 0;
        if (last > first) sparklineColor = "#22c55e"; // green
        else if (last < first) sparklineColor = "#ef4444"; // red
    }

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                height: "100%",
                padding: "12px 16px",
                textAlign: "center",
                gap: 4,
                background: "transparent",
            }}
        >
            {/* Label (top, small) */}
            <span
                style={{
                    fontSize: labelFontSize,
                    fontWeight: 600,
                    letterSpacing: "0.07em",
                    textTransform: "uppercase",
                    color: "#64748b",
                    lineHeight: 1.2,
                }}
            >
                {title}
            </span>

            {/* Value (centre, large) */}
            <span
                style={{
                    fontSize: valueFontSize,
                    fontWeight: 800,
                    color: valueColor,
                    lineHeight: 1.1,
                    letterSpacing: "-0.02em",
                    fontVariantNumeric: "tabular-nums",
                }}
            >
                {displayValue}
            </span>

            {/* Sparkline (optional) */}
            {sparklinePath && (
                <svg
                    viewBox="0 0 100 30"
                    preserveAspectRatio="none"
                    style={{ width: "80%", height: "30px", marginTop: "4px" }}
                >
                    <path
                        d={sparklinePath}
                        fill="none"
                        stroke={sparklineColor}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </svg>
            )}

            {/* Subtitle (bottom, small) */}
            {subtitle && (
                <span
                    style={{
                        fontSize: subtitleFontSize,
                        color: "#94a3b8",
                        lineHeight: 1.3,
                        maxWidth: "90%",
                    }}
                >
                    {subtitle}
                </span>
            )}
        </div>
    );
}
