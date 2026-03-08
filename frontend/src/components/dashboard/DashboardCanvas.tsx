import { useEffect, useCallback, useRef, useState } from "react";
import GridLayout, { WidthProvider, Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";
import { useDashboardStore } from "@/stores/dashboardStore";
import { useChatStore } from "@/stores/chatStore";
import TileCard from "./TileCard";
import type { TopLevelSpec } from "vega-lite";
import type { QueryMeta } from "@/types/dashboard";

const AutoWidthGrid = WidthProvider(GridLayout);

export default function DashboardCanvas() {
  const { tiles, addTile, addTableTile, addKpiTile, addTextTile, updateTile, updateTableTile, updateTileTitle, updateTileLayouts, removeTile, updateLayout } =
    useDashboardStore();
  const setVisualizationCallback = useChatStore((s) => s.setVisualizationCallback);
  const setUpdateVisualizationCallback = useChatStore((s) => s.setUpdateVisualizationCallback);
  const setUpdateLayoutCallback = useChatStore((s) => s.setUpdateLayoutCallback);
  const setGetTilesCallback = useChatStore((s) => s.setGetTilesCallback);
  const setDataTableCallback = useChatStore((s) => s.setDataTableCallback);
  const setUpdateDataTableCallback = useChatStore((s) => s.setUpdateDataTableCallback);
  const setKpiTileCallback = useChatStore((s) => s.setKpiTileCallback);
  const setTextTileCallback = useChatStore((s) => s.setTextTileCallback);
  const setUpdateTextCallback = useChatStore((s) => s.setUpdateTextCallback);
  const setRemoveTileCallback = useChatStore((s) => s.setRemoveTileCallback);
  const setUpdateTileTitleCallback = useChatStore((s) => s.setUpdateTileTitleCallback);

  // ── Z-index management ───────────────────────────────────────────────────
  // We track z-order per tile in React state. Because react-grid-layout
  // creates stacking contexts (via CSS transform), setting z-index on inner
  // divs doesn't work. Instead, we sort the children array so the clicked
  // tile renders last in the DOM, naturally placing it on top.
  const zCounter = useRef(1);
  const [zIndexMap, setZIndexMap] = useState<Record<string, number>>({});

  const bringToFront = useCallback((tileId: string) => {
    setZIndexMap((prev) => ({ ...prev, [tileId]: ++zCounter.current }));
  }, []);

  const sendToBack = useCallback((tileId: string) => {
    // To send backward, we assign a very low (or negative) z-index 
    // relative to what's been issued so far
    setZIndexMap((prev) => ({
      ...prev,
      [tileId]: Math.min(...Object.values(prev), 0) - 1
    }));
  }, []);

  useEffect(() => {
    // Add new chart tile
    setVisualizationCallback((data) => {
      const spec = data.vega_spec as unknown as TopLevelSpec;
      const title =
        typeof spec === "object" && spec !== null && "title" in spec
          ? String(spec.title)
          : "Chart";
      const queryMeta = data.query_meta as QueryMeta | undefined;
      addTile(data.tile_id, spec, title, queryMeta);
    });

    // Add new table tile
    setDataTableCallback((data) => {
      const queryMeta = data.query_meta as QueryMeta | undefined;
      addTableTile(data.tile_id, { columns: data.columns, rows: data.rows }, data.title, queryMeta);
    });

    // Update existing table tile in-place
    setUpdateDataTableCallback((data) => {
      updateTableTile(data.tile_id, { columns: data.columns, rows: data.rows }, data.title);
    });

    // Add new KPI metric tile
    setKpiTileCallback((data) => {
      addKpiTile(data.tile_id, {
        value: data.value,
        subtitle: data.subtitle,
        color: data.color,
        sparkline: data.sparkline,
      }, data.title);
    });

    // Add Text/Markdown tile
    setTextTileCallback((data) => {
      addTextTile(data.tile_id, data.markdown, data.title);
    });

    // Update Text/Markdown tile
    setUpdateTextCallback((data) => {
      useDashboardStore.getState().updateTextTile(data.tile_id, data.markdown);
    });

    // Remove a tile via agent
    setRemoveTileCallback((data) => {
      removeTile(data.tile_id);
    });

    // Rename tile header label
    setUpdateTileTitleCallback((data) => {
      updateTileTitle(data.tile_id, data.title);
    });

    // Update existing tile spec in place
    setUpdateVisualizationCallback((data) => {
      const spec = data.vega_spec as unknown as TopLevelSpec;
      updateTile(data.tile_id, spec);
    });

    // Update tile layouts from backend
    setUpdateLayoutCallback((data) => {
      updateTileLayouts(data.layouts);
    });

    // Expose current tiles (with layout info) so chatStore sends them to backend
    setGetTilesCallback(() =>
      useDashboardStore.getState().tiles.map((t) => ({
        tile_id: t.id,
        title: t.title,
        type: t.type,
        vega_spec: (t.vegaSpec ?? {}) as unknown as Record<string, unknown>,
        layout: { x: t.layout.x, y: t.layout.y, w: t.layout.w, h: t.layout.h },
      }))
    );
  }, [
    setVisualizationCallback,
    setDataTableCallback,
    setUpdateDataTableCallback,
    setKpiTileCallback,
    setTextTileCallback,
    setUpdateTextCallback,
    setRemoveTileCallback,
    setUpdateTileTitleCallback,
    setUpdateVisualizationCallback,
    setUpdateLayoutCallback,
    setGetTilesCallback,
    addTile,
    addTableTile,
    addKpiTile,
    addTextTile,
    updateTile,
    updateTableTile,
    updateTileTitle,
    updateTileLayouts,
    removeTile,
  ]);

  // Sync drag / resize changes back to the store
  const handleLayoutChange = useCallback(
    (newLayout: Layout[]) => {
      const layouts = newLayout.map((l) => ({
        i: l.i,
        x: l.x,
        y: l.y,
        w: l.w,
        h: l.h,
      }));
      updateLayout(layouts);
    },
    [updateLayout],
  );

  if (tiles.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/30">
        <div className="text-center text-muted-foreground">
          <div className="text-4xl mb-4">&#9776;</div>
          <p className="text-lg font-medium">Dashboard Canvas</p>
          <p className="text-sm mt-1">
            Ask the agent to create a visualization to get started.
          </p>
        </div>
      </div>
    );
  }

  const layout: Layout[] = tiles.map((t) => ({
    i: t.id,
    x: t.layout.x,
    y: t.layout.y,
    w: t.layout.w,
    h: t.layout.h,
    minW: 12,
    minH: 6,
  }));

  // Sort tiles so the ones with higher z-index render later in the DOM
  const sortedTiles = [...tiles].sort((a, b) => {
    const zA = zIndexMap[a.id] ?? 0;
    const zB = zIndexMap[b.id] ?? 0;
    return zA - zB;
  });

  return (
    <div className="h-full overflow-y-auto bg-muted/30">
      <AutoWidthGrid
        layout={layout}
        cols={96}
        rowHeight={12}
        onLayoutChange={handleLayoutChange}
        draggableHandle=".tile-drag-handle"
        isResizable={true}
        isDraggable={true}
        compactType={null}
        allowOverlap={true}
        margin={[16, 16]}
      >
        {sortedTiles.map((tile) => (
          <div
            key={tile.id}
            data-tile-id={tile.id}
            style={{ height: "100%" }}
            onMouseDown={() => bringToFront(tile.id)}
          >
            <TileCard
              tile={tile}
              onBringToFront={() => bringToFront(tile.id)}
              onSendToBack={() => sendToBack(tile.id)}
            />
          </div>
        ))}
      </AutoWidthGrid>
    </div>
  );
}
