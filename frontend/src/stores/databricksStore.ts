import { create } from "zustand";
import type { DatabricksStatus } from "@/types/databricks";
import {
  getDatabricksStatus,
  connectDatabricks,
  disconnectDatabricks,
  setDatabricksTableConfig,
  listDatabricksTables,
  reindexDatabricks,
} from "@/lib/databricksApi";

interface DatabricksState {
  status: DatabricksStatus | null;
  tables: string[];
  loading: boolean;
  reindexing: boolean;
  reindexMessage: string | null;
  error: string | null;

  fetchStatus: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  fetchTables: (catalog?: string, schema?: string) => Promise<void>;
  updateTableConfig: (table: string, catalog?: string, schema?: string) => Promise<void>;
  reindex: (catalog?: string, schema?: string) => Promise<void>;
  clearError: () => void;
}

export const useDatabricksStore = create<DatabricksState>((set) => ({
  status: null,
  tables: [],
  loading: false,
  reindexing: false,
  reindexMessage: null,
  error: null,

  fetchStatus: async () => {
    try {
      const status = await getDatabricksStatus();
      set({ status, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to fetch status" });
    }
  },

  connect: async () => {
    set({ loading: true, error: null });
    try {
      await connectDatabricks();
      // Start polling for connection completion
      const poll = setInterval(async () => {
        try {
          const status = await getDatabricksStatus();
          set({ status });
          if (status.connected || !status.connecting) {
            clearInterval(poll);
            set({ loading: false });
          }
        } catch {
          // Keep polling
        }
      }, 5000);
      // Safety: stop polling after 5 min
      setTimeout(() => {
        clearInterval(poll);
        set({ loading: false });
      }, 300_000);
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Connection failed" });
    }
  },

  disconnect: async () => {
    set({ loading: true, error: null });
    try {
      await disconnectDatabricks();
      const status = await getDatabricksStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Disconnect failed" });
    }
  },

  fetchTables: async (catalog?: string, schema?: string) => {
    try {
      const { tables } = await listDatabricksTables(catalog, schema);
      set({ tables, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to list tables" });
    }
  },

  updateTableConfig: async (table: string, catalog?: string, schema?: string) => {
    set({ loading: true, error: null });
    try {
      await setDatabricksTableConfig(table, catalog, schema);
      const status = await getDatabricksStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Failed to update table config" });
    }
  },

  reindex: async (catalog?: string, schema?: string) => {
    set({ reindexing: true, reindexMessage: null, error: null });
    try {
      const result = await reindexDatabricks(catalog, schema);
      set({ reindexing: false, reindexMessage: result.message });
    } catch (err) {
      set({
        reindexing: false,
        error: err instanceof Error ? err.message : "Re-index failed",
      });
    }
  },

  clearError: () => set({ error: null }),
}));
