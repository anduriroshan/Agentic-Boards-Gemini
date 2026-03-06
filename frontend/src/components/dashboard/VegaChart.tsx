import { useEffect, useRef, useState } from "react";
import { VegaLite } from "react-vega";
import type { TopLevelSpec } from "vega-lite";

interface VegaChartProps {
  spec: TopLevelSpec;
}

// ── Arc-chart spec normalizer ─────────────────────────────────────────────
// LLMs frequently produce broken Vega-Lite arc+text layer specs:
//   - `radius` placed in encoding instead of the mark object
//   - `theta` missing `stack: true` in one of the layers
//   - text layer missing its own `theta` encoding
//
// This function auto-corrects those issues so the chart always renders
// correctly regardless of what the LLM generates.

type AnySpec = Record<string, unknown>;

function isArcChart(spec: AnySpec): boolean {
  const mark = spec.mark as string | AnySpec | undefined;
  if (!mark) {
    // layered spec with no top-level mark — check layers
    const layers = spec.layer as AnySpec[] | undefined;
    if (layers) return layers.some((l) => {
      const m = l.mark as string | AnySpec | undefined;
      const t = typeof m === "string" ? m : (m as AnySpec)?.type as string;
      return t === "arc";
    });
    return false;
  }
  const markType = typeof mark === "string" ? mark : (mark as AnySpec).type as string;
  return markType === "arc";
}

// ── Extract key fields from any arc-layer structure ───────────────────────
// Handles both single-mark specs and layered specs.
function extractArcFields(spec: AnySpec): {
  thetaField: string;
  thetaType: string;
  colorField: string | undefined;
  colorType: string;
  textField: string | undefined;
  textFormat: string | undefined;
  innerRadius: number;
  tooltipEncodings: AnySpec[];
} {
  const DEFAULT = {
    thetaField: "",
    thetaType: "quantitative",
    colorField: undefined as string | undefined,
    colorType: "nominal",
    textField: undefined as string | undefined,
    textFormat: undefined as string | undefined,
    innerRadius: 0,
    tooltipEncodings: [] as AnySpec[],
  };

  // Collect all layers (or treat single-mark as one layer)
  const layers: AnySpec[] = (spec.layer as AnySpec[] | undefined) ?? [spec];

  let result = { ...DEFAULT };

  for (const layer of layers) {
    const m = layer.mark as string | AnySpec | undefined;
    const mType = typeof m === "string" ? m : (m as AnySpec)?.type as string;
    const enc = (layer.encoding ?? {}) as AnySpec;

    if (mType === "arc") {
      const theta = (enc.theta ?? {}) as AnySpec;
      result.thetaField = (theta.field as string | undefined) ?? result.thetaField;
      result.thetaType = (theta.type as string | undefined) ?? result.thetaType;

      const color = (enc.color ?? {}) as AnySpec;
      result.colorField = (color.field as string | undefined) ?? result.colorField;
      result.colorType = (color.type as string | undefined) ?? result.colorType;

      // innerRadius can live on the mark object OR as a default of 0
      const markObj = typeof m === "object" ? (m as AnySpec) : {};
      result.innerRadius = (markObj.innerRadius as number | undefined) ?? 0;

      // Collect tooltip encodings for the arc layer
      if (enc.tooltip) {
        result.tooltipEncodings = Array.isArray(enc.tooltip)
          ? (enc.tooltip as AnySpec[])
          : [enc.tooltip as AnySpec];
      }
    }

    if (mType === "text") {
      const textEnc = (enc.text ?? enc.theta ?? {}) as AnySpec;
      result.textField = (textEnc.field as string | undefined) ?? result.textField;
      result.textFormat = (textEnc.format as string | undefined) ?? result.textFormat;
    }
  }

  // If no dedicated text field was found, fall back to the theta field
  if (!result.textField && result.thetaField) {
    result.textField = result.thetaField;
  }

  return result;
}

function normalizeArcSpec(spec: AnySpec): AnySpec {
  if (!isArcChart(spec)) return spec;

  // Extract the data rows (may live on spec.data.values or layer[].data.values)
  const specData = spec.data as AnySpec | undefined;
  const dataValues = specData?.values as unknown[] | undefined;

  const {
    thetaField,
    thetaType,
    colorField,
    colorType,
    textField,
    textFormat,
    innerRadius,
    tooltipEncodings,
  } = extractArcFields(spec);

  if (!thetaField) return spec;  // can't normalize without a theta field

  // Decide label radius: sit just outside the midpoint of the arc ring.
  const labelRadius = innerRadius > 0 ? Math.round(innerRadius / 2 + 90) : 90;

  // Default tooltip: color field + theta field
  const tooltips: AnySpec[] = tooltipEncodings.length > 0
    ? tooltipEncodings
    : [
      ...(colorField ? [{ field: colorField, type: colorType }] : []),
      { field: thetaField, type: thetaType, format: textFormat ?? "," },
    ];

  // ── Rebuild spec with PRE-COMPUTED angles ─────────────────────────────
  //
  // WHY: Vega-Lite's `stack: true` computes stacking independently per
  // layer.  Subtle differences in grouping channels (color vs detail)
  // cause the arc layer and text layer to end up with different angular
  // positions — labels land on the wrong slices.
  //
  // FIX: We compute the slice angles ourselves via transforms and then
  // use `stack: false` on both layers so Vega-Lite treats the angles as
  // raw values.  Both layers reference the same computed fields, so
  // alignment is guaranteed.
  //
  //   _cumEnd     = running cumulative sum of thetaField (data order)
  //   _total      = grand total of thetaField
  //   _startAngle = (cumEnd − thisValue) / total × 2π
  //   _endAngle   = cumEnd / total × 2π
  //   _midAngle   = average of start and end (label placement)
  const {
    mark: _m,
    encoding: _e,
    layer: _l,
    transform: _t,
    ...rest
  } = spec;

  // Escape field name for use in Vega expressions (bracket notation)
  const tfExpr = thetaField.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return {
    ...rest,
    view: { stroke: null },
    transform: [
      // Running cumulative sum in data order
      {
        window: [{ op: "sum", field: thetaField, as: "_cumEnd" }],
        frame: [null, 0],
      },
      // Grand total for computing proportions
      {
        joinaggregate: [{ op: "sum", field: thetaField, as: "_total" }],
      },
      // Slice start angle
      {
        calculate: `(datum._cumEnd - datum['${tfExpr}']) / datum._total * 2 * PI`,
        as: "_startAngle",
      },
      // Slice end angle
      {
        calculate: "datum._cumEnd / datum._total * 2 * PI",
        as: "_endAngle",
      },
      // Label placement at the midpoint of each slice
      {
        calculate: "(datum._startAngle + datum._endAngle) / 2",
        as: "_midAngle",
      },
    ],
    layer: [
      // Layer 1 – arc slices with explicit start/end angles
      {
        mark: { type: "arc", innerRadius },
        encoding: {
          theta: { field: "_startAngle", type: "quantitative", stack: false },
          theta2: { field: "_endAngle" },
          ...(colorField
            ? { color: { field: colorField, type: colorType } }
            : {}),
          tooltip: tooltips,
        },
      },
      // Layer 2 – labels at each slice's angular midpoint
      {
        mark: { type: "text", radius: labelRadius, fontSize: 11, color: "#333333" },
        encoding: {
          theta: { field: "_midAngle", type: "quantitative", stack: false },
          text: {
            field: textField ?? thetaField,
            type: thetaType,
            ...(textFormat ? { format: textFormat } : {}),
          },
        },
      },
    ],
    data: dataValues !== undefined ? { values: dataValues } : specData,
  };
}

export default function VegaChart({ spec }: VegaChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) {
        setDims({ w: Math.floor(width), h: Math.floor(height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const normalized = normalizeArcSpec(spec as unknown as AnySpec) as unknown as TopLevelSpec;

  const responsiveSpec: TopLevelSpec = {
    ...normalized,
    title: undefined,   // tile header already shows the title — don't render it twice inside the chart
    background: "transparent",
    width: dims ? dims.w - 20 : ("container" as unknown as number),
    height: dims ? dims.h - 20 : ("container" as unknown as number),
    autosize: { type: "fit", contains: "padding" },
  };

  return (
    <div ref={containerRef} style={{ width: "100%", height: "100%" }}>
      <VegaLite
        spec={responsiveSpec}
        actions={false}
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
