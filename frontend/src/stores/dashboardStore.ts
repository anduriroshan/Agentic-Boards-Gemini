import { create } from "zustand";
import type { DashboardTile, TileLayout, TableData, QueryMeta } from "@/types/dashboard";
import type { TopLevelSpec } from "vega-lite";

interface DashboardState {
  tiles: DashboardTile[];
  addTile: (tileId: string, spec: import("vega-lite").TopLevelSpec, title?: string, queryMeta?: import("@/types/dashboard").QueryMeta) => void;
  addTableTile: (tileId: string, tableData: import("@/types/dashboard").TableData, title?: string, queryMeta?: import("@/types/dashboard").QueryMeta) => void;
  addKpiTile: (tileId: string, kpiData: import("@/types/dashboard").KpiData, title: string) => void;
  addTextTile: (tileId: string, markdown: string, title?: string, fontSize?: string) => void;
  updateTile: (tileId: string, spec: TopLevelSpec) => void;
  updateTableTile: (tileId: string, tableData: TableData, title?: string) => void;
  updateTextTile: (tileId: string, markdown: string, fontSize?: string) => void;
  updateTileTitle: (tileId: string, title: string) => void;
  updateTileQueryMeta: (tileId: string, queryMeta: QueryMeta) => void;
  updateTileLayouts: (layoutUpdates: { tile_id: string; x: number; y: number; w: number; h: number }[]) => void;
  addComment: (tileId: string, text: string, author?: string) => void;
  deleteComment: (tileId: string, commentId: string) => void;
  removeTile: (tileId: string) => void;
  updateLayout: (layouts: TileLayout[]) => void;
  clearDashboard: () => void;
}

// Helper to find the next available position for a new tile.
// Simple strategy: place below the lowest existing tile.
function getNextPosition(currentTiles: DashboardTile[]): { x: number; y: number } {
  if (currentTiles.length === 0) {
    return { x: 0, y: 0 };
  }
  const maxY = Math.max(...currentTiles.map((tile) => tile.layout.y + tile.layout.h));
  return { x: 0, y: maxY + 1 };
}


// The original nextCol/nextRow logic is now replaced by getNextPosition
// let nextCol = 0;
// let nextRow = 0;

// function _nextLayout(tileId: string): TileLayout {
//   const layout: TileLayout = {
//     i: tileId,
//     x: nextCol * 6,
//     y: nextRow * 4,
//     w: 6,
//     h: 4,
//   };
//   nextCol = (nextCol + 1) % 2;
//   if (nextCol === 0) nextRow++;
//   return layout;
// }

export const useDashboardStore = create<DashboardState>((set) => ({
  tiles: [],

  addTile: (tileId, spec, title, queryMeta) => {
    set((state) => {
      const existing = state.tiles.find((t) => t.id === tileId);
      if (existing) {
        return {
          tiles: state.tiles.map((t) =>
            t.id === tileId ? { ...t, vegaSpec: spec, title: title || t.title, queryMeta } : t
          ),
        };
      }
      const { x, y } = getNextPosition(state.tiles);
      const tile: DashboardTile = {
        id: tileId,
        title: title || "Chart",
        type: "chart",
        vegaSpec: spec,
        queryMeta,
        layout: { i: tileId, x, y, w: 48, h: 32 },
      };
      return { tiles: [...state.tiles, tile] };
    });
  },

  addTableTile: (tileId, tableData, title, queryMeta) => {
    set((state) => {
      const existing = state.tiles.find((t) => t.id === tileId);
      if (existing) {
        return {
          tiles: state.tiles.map((t) =>
            t.id === tileId ? { ...t, tableData, title: title || t.title, queryMeta } : t
          ),
        };
      }
      const { x, y } = getNextPosition(state.tiles);
      const tile: DashboardTile = {
        id: tileId,
        title: title || "Table",
        type: "table",
        tableData,
        queryMeta,
        layout: { i: tileId, x, y, w: 48, h: 32 },
      };
      return { tiles: [...state.tiles, tile] };
    });
  },

  addKpiTile: (tileId, kpiData, title) => {
    set((state) => {
      const existing = state.tiles.find((t) => t.id === tileId);
      if (existing) {
        return {
          tiles: state.tiles.map((t) =>
            t.id === tileId ? { ...t, type: "kpi", kpiData, title: title || t.title } : t
          ),
        };
      }

      const { x, y } = getNextPosition(state.tiles);
      const tile: DashboardTile = {
        id: tileId,
        title: title || "Key Metric",
        type: "kpi",
        kpiData,
        layout: { i: tileId, x, y, w: 24, h: 16 }, // Compact layout for KPIs
      };
      return { tiles: [...state.tiles, tile] };
    });
  },

  addTextTile: (tileId, markdown, title = "Notes", fontSize) => {
    set((state) => {
      const existing = state.tiles.find((t) => t.id === tileId);
      if (existing) {
        return {
          tiles: state.tiles.map((t) =>
            t.id === tileId ? { ...t, type: "text", textData: { markdown, fontSize }, title } : t
          ),
        };
      }
      const { x, y } = getNextPosition(state.tiles);
      const newTile: DashboardTile = {
        id: tileId,
        title,
        type: "text",
        textData: { markdown, fontSize },
        layout: { i: tileId, x, y, w: 48, h: 24 },
      };
      return { tiles: [...state.tiles, newTile] };
    });
  },

  updateTile: (tileId, spec) => {
    set((s) => ({
      tiles: s.tiles.map((t) =>
        t.id === tileId ? { ...t, vegaSpec: spec } : t
      ),
    }));
  },

  updateTableTile: (tileId, tableData, title) => {
    set((s) => ({
      tiles: s.tiles.map((t) =>
        t.id === tileId
          ? { ...t, tableData, ...(title ? { title } : {}) }
          : t
      ),
    }));
  },

  updateTextTile: (tileId, markdown, fontSize) => {
    set((s) => ({
      tiles: s.tiles.map((t) =>
        t.id === tileId && t.type === "text"
          ? { ...t, textData: { markdown, fontSize: fontSize !== undefined ? fontSize : t.textData?.fontSize } }
          : t
      ),
    }));
  },

  updateTileTitle: (tileId, title) => {
    set((s) => ({
      tiles: s.tiles.map((t) => (t.id === tileId ? { ...t, title } : t)),
    }));
  },

  updateTileQueryMeta: (tileId, queryMeta) => {
    set((s) => ({
      tiles: s.tiles.map((t) =>
        t.id === tileId ? { ...t, queryMeta } : t
      ),
    }));
  },

  updateTileLayouts: (layoutUpdates) => {
    set((s) => ({
      tiles: s.tiles.map((tile) => {
        const update = layoutUpdates.find((u) => u.tile_id === tile.id);
        if (update) {
          return {
            ...tile,
            layout: { i: tile.id, x: update.x, y: update.y, w: update.w, h: update.h },
          };
        }
        return tile;
      }),
    }));
  },

  addComment: (tileId, text, author = "User") => {
    set((s) => ({
      tiles: s.tiles.map((t) => {
        if (t.id === tileId) {
          const newComment = {
            id: crypto.randomUUID(),
            text,
            author,
            createdAt: Date.now(),
          };
          return { ...t, comments: [...(t.comments || []), newComment] };
        }
        return t;
      }),
    }));
  },

  deleteComment: (tileId, commentId) => {
    set((s) => ({
      tiles: s.tiles.map((t) => {
        if (t.id === tileId) {
          return {
            ...t,
            comments: (t.comments || []).filter((c) => c.id !== commentId),
          };
        }
        return t;
      }),
    }));
  },

  removeTile: (tileId) => {
    set((s) => ({
      tiles: s.tiles.filter((t) => t.id !== tileId),
    }));
  },

  updateLayout: (layouts) => {
    set((s) => ({
      tiles: s.tiles.map((tile) => {
        const newLayout = layouts.find((l) => l.i === tile.id);
        return newLayout ? { ...tile, layout: newLayout } : tile;
      }),
    }));
  },

  clearDashboard: () => {
    set({ tiles: [] });
  },
}));
