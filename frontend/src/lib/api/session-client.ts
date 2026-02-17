import type { SessionState, RiskGateConfig } from "./types";

const API_BASE = "/api";

interface AgentResponse<T> {
  action: string;
  result?: T;
  error?: string;
}

async function callAgent<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${API_BASE}/agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, params }),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data: AgentResponse<T> = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }

  return data.result as T;
}

export const sessionClient = {
  async getSessionState(): Promise<SessionState> {
    return callAgent<SessionState>("get_session_state");
  },

  async getRiskConfig(): Promise<RiskGateConfig> {
    return callAgent<RiskGateConfig>("get_risk_config");
  },

  async lockSession(reason?: string): Promise<{ locked: boolean }> {
    return callAgent<{ locked: boolean }>("session_lock", { reason });
  },

  async unlockSession(): Promise<void> {
    await callAgent<void>("session_unlock");
  },

  async resetSession(): Promise<void> {
    await callAgent<void>("session_reset");
  },

  async recordTrade(realizedPnl: number): Promise<void> {
    await callAgent<void>("session_record_trade", { realizedPnl });
  },
};
