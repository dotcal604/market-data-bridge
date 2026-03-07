import type {
  DivoomStatusData,
  DivoomPreviewData,
  DeviceSettings,
  CompositeSettings,
  ContentSettings,
  LayoutSettings,
  WidgetInfo,
  ConfigDefaults,
} from "./types";

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

  // Config store
  getDevice: () => fetchJSON<DeviceSettings>(`${API_BASE}/config/device`),
  setDevice: (patch: Partial<DeviceSettings>) =>
    postJSON<DeviceSettings>(`${API_BASE}/config/device`, patch),
  getComposite: () => fetchJSON<CompositeSettings>(`${API_BASE}/config/composite`),
  setComposite: (patch: Partial<CompositeSettings>) =>
    postJSON<CompositeSettings>(`${API_BASE}/config/composite`, patch),
  getContent: () => fetchJSON<ContentSettings>(`${API_BASE}/config/content`),
  setContent: (patch: Partial<ContentSettings>) =>
    postJSON<ContentSettings>(`${API_BASE}/config/content`, patch),
  getLayout: () => fetchJSON<LayoutSettings>(`${API_BASE}/config/layout`),
  setLayout: (patch: Partial<LayoutSettings>) =>
    postJSON<LayoutSettings>(`${API_BASE}/config/layout`, patch),
  getWidgets: () => fetchJSON<WidgetInfo[]>(`${API_BASE}/config/widgets`),
  resetConfig: () => postJSON<ConfigDefaults>(`${API_BASE}/config/reset`),
};
