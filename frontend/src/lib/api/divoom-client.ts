import type { DivoomStatusData, DivoomPreviewData } from "./types";

const API_BASE = "/api/divoom";

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return json.data as T;
}

async function postJSON<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const json = await res.json();
  return json.data as T;
}

export interface BgClearSettings {
  brightness: number;
  tint: "neutral" | "blue" | "green";
  color: string | null;
}

export const divoomClient = {
  getStatus: () => fetchJSON<DivoomStatusData>(`${API_BASE}/status`),
  getPreview: () => fetchJSON<DivoomPreviewData | null>(`${API_BASE}/preview`),
  setBrightness: (value: number) =>
    postJSON<{ brightness: number }>(`${API_BASE}/brightness`, { value }),
  refresh: () => postJSON<{ message: string }>(`${API_BASE}/refresh`),
  getBackground: () => fetchJSON<BgClearSettings>(`${API_BASE}/config/background`),
  setBackground: (patch: Partial<BgClearSettings>) =>
    postJSON<BgClearSettings>(`${API_BASE}/config/background`, patch),
};
