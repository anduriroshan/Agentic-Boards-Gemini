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

// Helper to find the next available position for a new tile
// This replaces the global nextCol/nextRow logic for more robust placement
function getNextPosition(currentTiles: DashboardTile[]): { x: number; y: number } {
  const GRID_COLS = 96; // 96-column grid for extreme precision
  const DEFAULT_TILE_WIDTH = 48;
  const DEFAULT_TILE_HEIGHT = 32;

  let maxY = 0;
  if (currentTiles.length > 0) {
    maxY = Math.max(...currentTiles.map(tile => tile.layout.y + tile.layout.h));
  }

  // Simple placement: try to place in the first available spot in the next row
  // or append to the right if space allows.
  // For simplicity, let's just stack them for now, or find the lowest available spot.
  // A more sophisticated algorithm would check for overlaps.
  let nextX = 0;
  let nextY = maxY;

  // Find the lowest point in the grid and place the new tile there,
  // or in the next available spot in the current row if it fits.
  // This is a basic implementation; a real layout engine would be more complex.
  let foundSpot = false;
  for (let y = 0; y <= maxY + DEFAULT_TILE_HEIGHT; y += 1) { // Check rows
    for (let x = 0; x <= GRID_COLS - DEFAULT_TILE_WIDTH; x += 1) { // Check columns
      const potentialLayout = { x, y, w: DEFAULT_TILE_WIDTH, h: DEFAULT_TILE_HEIGHT };
      const overlaps = currentTiles.some(tile => {
        const existingLayout = tile.layout;
        return !(
          potentialLayout.x + potentialLayout.w <= existingLayout.x ||
          potentialLayout.x >= existingLayout.x + existingLayout.w ||
          potentialLayout.y + potentialLayout.h <= existingLayout.y ||
          potentialLayout.y >= existingLayout.y + existingLayout.h
        );
      });
      if (!overlaps) {
        nextX = x;
        nextY = y;
        foundSpot = true;
        break;
      }
    }
    if (foundSpot) break;
  }

  if (!foundSpot) {
    // If no spot found, just place it at the end of the current max Y
    nextX = 0;
    nextY = maxY + 1; // Place it below the lowest tile
  }

  return { x: nextX, y: nextY };
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
