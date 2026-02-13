import { create } from "zustand";

export interface EvalFilterState {
  symbol: string; // empty = all
  dateFrom: string | null; // ISO date
  dateTo: string | null; // ISO date
  scoreMin: number; // 0-100
  scoreMax: number; // 0-100
  shouldTrade: boolean | null; // null = all, true/false = filter
}

interface EvalFilterStore extends EvalFilterState {
  setSymbol: (symbol: string) => void;
  setDateFrom: (date: string | null) => void;
  setDateTo: (date: string | null) => void;
  setScoreRange: (min: number, max: number) => void;
  setShouldTrade: (value: boolean | null) => void;
  clearFilters: () => void;
}

const defaultFilters: EvalFilterState = {
  symbol: "",
  dateFrom: null,
  dateTo: null,
  scoreMin: 0,
  scoreMax: 100,
  shouldTrade: null,
};

export const useEvalFilters = create<EvalFilterStore>((set) => ({
  ...defaultFilters,
  setSymbol: (symbol) => set({ symbol }),
  setDateFrom: (dateFrom) => set({ dateFrom }),
  setDateTo: (dateTo) => set({ dateTo }),
  setScoreRange: (scoreMin, scoreMax) => set({ scoreMin, scoreMax }),
  setShouldTrade: (shouldTrade) => set({ shouldTrade }),
  clearFilters: () => set(defaultFilters),
}));
