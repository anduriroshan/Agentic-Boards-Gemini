import { useRef, useCallback } from "react";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useAgentStore } from "@/stores/agentStore";

type ToolCallMessage = {
  type: "tool_call";
  name: string;
  args: any;
  query_meta?: any;
  turn_id?: string;
  tool_call_id?: string;
  tool_call_key?: string;
};

function tryParse(val: any) {
  if (typeof val === "string") {
    try { return JSON.parse(val); } catch { return val; }
  }
  return val;
}

function normalizeRows(rows: any): Record<string, unknown>[] {
  const parsed = tryParse(rows);
  const candidate = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (Array.isArray((parsed as any).rows) ? (parsed as any).rows : parsed)
    : parsed;
  if (!Array.isArray(candidate)) return [];
  if (candidate.every((r) => r && typeof r === "object" && !Array.isArray(r))) return candidate;
  return [];
}

function normalizeColumns(cols: any, rows: Record<string, unknown>[] = []) {
  const parsed = tryParse(cols);
  const fromPayload = Array.isArray(parsed) ? parsed : [];
  const normalized = fromPayload.map((c) => {
    if (typeof c === "string") return { field: c, headerName: c };
    const field = c?.field || c?.headerName || c?.name || c?.key || c?.column || c?.column_name;
    return { field: field || "", headerName: c?.headerName || c?.header || c?.label || field || "" };
  }).filter((c) => !!c.field);

  const deduped: { field: string; headerName: string }[] = [];
  const seen = new Set<string>();
  normalized.forEach((c) => {
    if (!seen.has(c.field)) {
      seen.add(c.field);
      deduped.push({ field: c.field, headerName: c.headerName || c.field });
    }
  });
  if (deduped.length > 0) return deduped;

  const firstRow = rows[0];
  if (firstRow && typeof firstRow === "object") {
    return Object.keys(firstRow).map((field) => ({ field, headerName: field }));
  }
  return [];
}

function asUpdateList(value: any): any[] {
  if (Array.isArray(value)) return value.filter((v) => v && typeof v === "object");
  if (value && typeof value === "object") return [value];
  return [];
}

function normalizeTileId(update: any): string | undefined {
  const tileId = update?.tile_id || update?.tileId;
  return typeof tileId === "string" ? tileId : undefined;
}

function extractSpecPatch(update: any): Record<string, unknown> | null {
  const nested = update?.vega_spec ?? update?.vegaSpec ?? update?.spec;
  if (nested !== undefined) {
    const parsed = tryParse(nested);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  }
  const directPatchEntries = Object.entries(update || {}).filter(
    ([k]) => !["tile_id", "tileId", "vega_spec", "vegaSpec", "spec"].includes(k),
  );
  return directPatchEntries.length === 0 ? null : Object.fromEntries(directPatchEntries);
}

function deepMerge(base: any, patch: any): any {
  if (Array.isArray(patch) || patch === null || typeof patch !== "object") return patch;
  if (!base || typeof base !== "object" || Array.isArray(base)) return patch;
  const out: Record<string, unknown> = { ...base };
  Object.keys(patch).forEach((key) => {
    const next = (patch as Record<string, unknown>)[key];
    const prev = (base as Record<string, unknown>)[key];
    if (next && typeof next === "object" && !Array.isArray(next) && prev && typeof prev === "object" && !Array.isArray(prev)) {
      out[key] = deepMerge(prev, next);
      return;
    }
    out[key] = next;
  });
  return out;
}

function normalizeModifyPayload(raw: any): Record<string, any> | null {
  const parsedRaw = tryParse(raw);

  type ModifyBucket = { spec_updates: any[]; layout_updates: any[]; title_updates: any[]; kpi_updates: any[]; text_updates: any[] };
  const bucket: ModifyBucket = { spec_updates: [], layout_updates: [], title_updates: [], kpi_updates: [], text_updates: [] };

  const pushWithTileId = (target: keyof ModifyBucket, value: any, tileId?: string) => {
    if (!value || typeof value !== "object") return;
    const withTile = tileId && !value.tile_id && !value.tileId ? { ...value, tile_id: tileId } : value;
    bucket[target].push(withTile);
  };

  const consumeGroup = (target: keyof ModifyBucket, value: any, tileId?: string) => {
    const group = tryParse(value);
    if (Array.isArray(group)) { group.forEach((g) => pushWithTileId(target, g, tileId)); return true; }
    if (group && typeof group === "object") { pushWithTileId(target, group, tileId); return true; }
    return false;
  };

  const consumeItem = (itemRaw: any) => {
    const item = tryParse(itemRaw);
    if (!item || typeof item !== "object" || Array.isArray(item)) return;
    const tileId = normalizeTileId(item);

    if (
      consumeGroup("spec_updates", item.spec_updates, tileId)
      || consumeGroup("spec_updates", item.specUpdates, tileId)
      || consumeGroup("layout_updates", item.layout_updates, tileId)
      || consumeGroup("layout_updates", item.layoutUpdates, tileId)
      || consumeGroup("title_updates", item.title_updates, tileId)
      || consumeGroup("title_updates", item.titleUpdates, tileId)
      || consumeGroup("kpi_updates", item.kpi_updates, tileId)
      || consumeGroup("kpi_updates", item.kpiUpdates, tileId)
      || consumeGroup("text_updates", item.text_updates, tileId)
      || consumeGroup("text_updates", item.textUpdates, tileId)
    ) return;

    if ("vega_spec" in item || "vegaSpec" in item || "spec" in item || "mark" in item || "encoding" in item || "layer" in item || "data" in item) {
      pushWithTileId("spec_updates", item, tileId);
    } else if ("x" in item && "y" in item && "w" in item && "h" in item) {
      pushWithTileId("layout_updates", item, tileId);
    } else if ("markdown" in item) {
      pushWithTileId("text_updates", item, tileId);
    } else if ("value" in item || "subtitle" in item || "color" in item) {
      pushWithTileId("kpi_updates", item, tileId);
    } else if ("title" in item) {
      pushWithTileId("title_updates", item, tileId);
    }
  };

  if (Array.isArray(parsedRaw)) parsedRaw.forEach(consumeItem);
  else if (parsedRaw && typeof parsedRaw === "object") consumeItem(parsedRaw);
  else return null;

  return bucket;
}

export function useToolHandler() {
  const processedToolCallKeysRef = useRef<Set<string>>(new Set());
  const lastToolMutationAtRef = useRef(0);

  const {
    addTile, addTableTile, addKpiTile, addTextTile,
    updateTile, updateTableTile, updateTileTitle, updateTextTile,
    updateTileLayouts, removeTile,
  } = useDashboardStore();

  const { upsertStep } = useAgentStore();

  const markToolMutation = useCallback(() => {
    lastToolMutationAtRef.current = Date.now();
  }, []);

  const shouldApplyToolCall = useCallback((msg: ToolCallMessage, currentTurnId: string | null) => {
    const turnId = msg.turn_id || currentTurnId || "turn_unknown";
    if (msg.turn_id && currentTurnId && msg.turn_id !== currentTurnId) return false;

    const identity = msg.tool_call_key || msg.tool_call_id || `${msg.name}:${JSON.stringify(msg.args ?? {})}`;
    const dedupeKey = `${turnId}:${identity}`;

    if (processedToolCallKeysRef.current.has(dedupeKey)) return false;
    processedToolCallKeysRef.current.add(dedupeKey);
    if (processedToolCallKeysRef.current.size > 2000) processedToolCallKeysRef.current.clear();
    return true;
  }, []);

  const handleToolCall = useCallback((name: string, args: any, queryMeta?: any) => {
    console.log("[LIVE] Tool call:", name, args, "queryMeta:", queryMeta);

    switch (name) {
      case "create_visualization":
        addTile(args.tile_id || crypto.randomUUID(), tryParse(args.vega_lite_spec), "Generated Chart", queryMeta);
        markToolMutation();
        break;
      case "create_data_table": {
        const rows = normalizeRows(args.rows);
        const columns = normalizeColumns(args.columns, rows);
        addTableTile(args.tile_id || crypto.randomUUID(), { columns, rows }, args.title || "Data Table", queryMeta);
        markToolMutation();
        break;
      }
      case "update_data_table": {
        const rows = normalizeRows(args.rows);
        const columns = normalizeColumns(args.columns, rows);
        updateTableTile(args.tile_id, { columns, rows }, args.title);
        markToolMutation();
        break;
      }
      case "create_kpi_tile":
        addKpiTile(
          args.tile_id || crypto.randomUUID(),
          { value: args.value, subtitle: args.subtitle, color: args.color, sparkline: args.sparkline_data ? tryParse(args.sparkline_data) : undefined },
          args.title || "KPI",
          queryMeta,
        );
        markToolMutation();
        break;
      case "create_text_tile":
        addTextTile(args.tile_id || crypto.randomUUID(), args.markdown, args.title || "Notes");
        markToolMutation();
        break;
      case "modify_dashboard": {
        const mods = normalizeModifyPayload(args.modifications);
        if (!mods) break;

        const existingIds = new Set(useDashboardStore.getState().tiles.map((t) => t.id));
        let requestedOps = 0;
        let appliedOps = 0;
        const missingIds: string[] = [];
        const recordMissing = (tileId?: string) => { if (tileId && !missingIds.includes(tileId)) missingIds.push(tileId); };

        const layoutUpdatesRaw = asUpdateList(mods.layout_updates);
        requestedOps += layoutUpdatesRaw.length;
        const layoutUpdates = layoutUpdatesRaw.filter((u: any) => {
          const tileId = normalizeTileId(u);
          const found = !!tileId && existingIds.has(tileId);
          if (!found) recordMissing(tileId);
          return found;
        });
        if (layoutUpdates.length > 0) {
          updateTileLayouts(layoutUpdates.map((u: any) => ({ ...u, tile_id: normalizeTileId(u) })));
          appliedOps += layoutUpdates.length;
        }

        const titleUpdates = asUpdateList(mods.title_updates);
        requestedOps += titleUpdates.length;
        titleUpdates.forEach((u: any) => {
          const tileId = normalizeTileId(u);
          if (!tileId || !existingIds.has(tileId)) { recordMissing(tileId); return; }
          updateTileTitle(tileId, u.title);
          appliedOps += 1;
        });

        const specUpdates = asUpdateList(mods.spec_updates);
        requestedOps += specUpdates.length;
        specUpdates.forEach((u: any) => {
          const tileId = normalizeTileId(u);
          if (!tileId || !existingIds.has(tileId)) { recordMissing(tileId); return; }
          const incomingSpec = extractSpecPatch(u);
          if (!incomingSpec) { recordMissing(tileId); return; }
          const existingTile = useDashboardStore.getState().tiles.find((t) => t.id === tileId && t.type === "chart");
          const mergedSpec = existingTile?.vegaSpec ? deepMerge(existingTile.vegaSpec, incomingSpec) : incomingSpec;
          updateTile(tileId, mergedSpec);
          appliedOps += 1;
        });

        const kpiUpdates = asUpdateList(mods.kpi_updates);
        requestedOps += kpiUpdates.length;
        kpiUpdates.forEach((u: any) => {
          const tileId = normalizeTileId(u);
          if (!tileId || !existingIds.has(tileId)) { recordMissing(tileId); return; }
          const existingKpi = useDashboardStore.getState().tiles.find((t) => t.id === tileId && t.type === "kpi")?.kpiData;
          addKpiTile(tileId, {
            value: u.value ?? existingKpi?.value ?? "",
            subtitle: u.subtitle ?? existingKpi?.subtitle ?? "",
            color: u.color ?? existingKpi?.color ?? "",
            sparkline: existingKpi?.sparkline,
            fontSize: existingKpi?.fontSize,
          }, "");
          appliedOps += 1;
        });

        const textUpdates = asUpdateList(mods.text_updates);
        requestedOps += textUpdates.length;
        textUpdates.forEach((u: any) => {
          const tileId = normalizeTileId(u);
          if (!tileId || !existingIds.has(tileId)) { recordMissing(tileId); return; }
          updateTextTile(tileId, u.markdown);
          appliedOps += 1;
        });

        if (requestedOps > 0 && appliedOps === 0) {
          const missingInfo = missingIds.length > 0 ? ` Missing tile IDs: ${missingIds.join(", ")}` : "";
          upsertStep({
            step_id: crypto.randomUUID(), phase: "result", agent: "DashboardAgent", icon: "layout",
            summary: `No matching tiles found for modify request.${missingInfo}`.slice(0, 200),
            status: "done", ts: Date.now(),
          });
        }
        if (appliedOps > 0) markToolMutation();
        break;
      }
      case "remove_tiles": {
        const tileIds = tryParse(args.tile_ids);
        let removed = 0;
        if (Array.isArray(tileIds)) { tileIds.forEach((id: string) => { removeTile(id); removed += 1; }); }
        else if (typeof tileIds === "string") { removeTile(tileIds); removed += 1; }
        if (removed > 0) markToolMutation();
        break;
      }
      default:
        console.warn("Unknown tool call from live agent:", name);
    }
  }, [addTile, addTableTile, addKpiTile, addTextTile, updateTile, updateTableTile, updateTileTitle, updateTextTile, updateTileLayouts, removeTile, upsertStep, markToolMutation]);

  const clearProcessedKeys = useCallback(() => {
    processedToolCallKeysRef.current.clear();
  }, []);

  return {
    handleToolCall,
    shouldApplyToolCall,
    markToolMutation,
    lastToolMutationAtRef,
    clearProcessedKeys,
  };
}
