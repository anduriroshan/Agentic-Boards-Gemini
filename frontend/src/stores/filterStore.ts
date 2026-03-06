import { create } from "zustand";

export interface GlobalFilters {
    dateFrom: string; // YYYY-MM-DD
    dateTo: string;   // YYYY-MM-DD
}

interface FilterState {
    filters: GlobalFilters;
    setDateRange: (from: string, to: string) => void;
    clearFilters: () => void;
}

const defaultFilters: GlobalFilters = {
    dateFrom: "",
    dateTo: "",
};

export const useFilterStore = create<FilterState>((set) => ({
    filters: { ...defaultFilters },

    setDateRange: (dateFrom, dateTo) => {
        set((state) => ({
            filters: { ...state.filters, dateFrom, dateTo },
        }));
    },

    clearFilters: () => {
        set({ filters: { ...defaultFilters } });
    },
}));
