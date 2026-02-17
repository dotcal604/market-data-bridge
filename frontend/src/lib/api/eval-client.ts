import type {
  EvalDetail,
  EvalHistoryResponse,
  EvalOutcomesResponse,
  EvalStats,
  EnsembleWeights,
  EvalResponse,
} from "./types";
import { fetchJson } from "./fetch-json";

const BASE = "/api/eval";

export const evalClient = {
  evaluate(symbol: string, direction = "long", entryPrice?: number, stopPrice?: number, notes?: string) {
    return fetchJson<EvalResponse>(`${BASE}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbol,
        direction,
        entry_price: entryPrice ?? null,
        stop_price: stopPrice ?? null,
        notes: notes ?? null,
      }),
    });
  },

  getHistory(limit = 50, symbol?: string) {
    const params = new URLSearchParams({ limit: String(limit) });
    if (symbol) params.set("symbol", symbol);
    return fetchJson<EvalHistoryResponse>(`${BASE}/history?${params}`);
  },

  getById(id: string) {
    return fetchJson<EvalDetail>(`${BASE}/${id}`);
  },

  getStats() {
    return fetchJson<EvalStats>(`${BASE}/stats`);
  },

  getWeights() {
    return fetchJson<EnsembleWeights>(`${BASE}/weights`);
  },

  getOutcomes(limit = 500) {
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchJson<EvalOutcomesResponse>(`${BASE}/outcomes?${params}`);
  },

  recordOutcome(evaluationId: string, data: {
    trade_taken?: boolean;
    actual_entry_price?: number;
    actual_exit_price?: number;
    r_multiple?: number;
    exit_reason?: string;
    notes?: string;
  }) {
    return fetchJson<{ success: boolean }>(`${BASE}/outcome`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evaluation_id: evaluationId, ...data }),
    });
  },

  getCalibration() {
    return fetchJson<{
      calibration: Array<{
        model_id: string;
        sample_size: number;
        buckets: Array<{
          bucket: string;
          midpoint: number;
          predicted_win_rate: number;
          actual_win_rate: number;
          sample_size: number;
        }>;
      }>;
    }>(`${BASE}/calibration`);
  },

  getModelAgreement() {
    return fetchJson<{
      agreement: Record<string, Record<string, number>>;
      models: string[];
    }>(`${BASE}/model-agreement`);
  },

  updateWeights(weights: Record<string, number>) {
    return fetchJson<{ saved: boolean }>(`${BASE}/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(weights),
    });
  },

  getWeightHistory() {
    return fetchJson<
      Array<{
        claude: number;
        gpt4o: number;
        gemini: number;
        k: number;
        sample_size: number;
        updated_at: string;
      }>
    >(`${BASE}/weights/history`);
  },

  simulateWeights(params: {
    claude: number;
    gpt4o: number;
    gemini: number;
    k?: number;
    days?: number;
    symbol?: string;
  }) {
    return fetchJson<{
      avg_score_delta: number;
      trade_rate_delta: number;
      accuracy_delta: number;
      decisions_changed: number;
      sample_size: number;
    }>(`${BASE}/weights/simulate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
    });
  },
};
