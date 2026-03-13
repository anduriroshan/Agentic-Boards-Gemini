import { create } from "zustand";
import {
  getBigQueryStatus,
  connectBigQuery,
  setBigQueryTableConfig,
  listBigQueryTables,
  type BigQueryStatus,
} from "@/lib/bigqueryApi";

interface BigQueryState {
  status: BigQueryStatus | null;
  tables: string[];
  loading: boolean;
  error: string | null;

  fetchStatus: () => Promise<void>;
  connect: () => Promise<void>;
  fetchTables: (dataset?: string) => Promise<void>;
  updateTableConfig: (table: string) => Promise<void>;
  clearError: () => void;
}

export const useBigQueryStore = create<BigQueryState>((set) => ({
  status: null,
  tables: [],
  loading: false,
  error: null,

  fetchStatus: async () => {
    try {
      const status = await getBigQueryStatus();
      set({ status, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to fetch status" });
    }
  },

  connect: async () => {
    set({ loading: true, error: null });
    try {
      const status = await connectBigQuery();
      set({ status, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Connection failed" });
    }
  },

  fetchTables: async (dataset?: string) => {
    try {
      const { tables } = await listBigQueryTables(dataset);
      set({ tables, error: null });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to list tables" });
    }
  },

  updateTableConfig: async (table: string) => {
    set({ loading: true, error: null });
    try {
      await setBigQueryTableConfig(table);
      const status = await getBigQueryStatus();
      set({ status, loading: false });
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : "Failed to update table config" });
    }
  },

  clearError: () => set({ error: null }),
}));
