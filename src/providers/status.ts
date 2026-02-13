import { isConnected, getConnectionStatus } from "../ibkr/connection.js";

function getMarketSession(): { easternTime: string; session: string } {
  const now = new Date();
  const et = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const h = et.getHours();
  const m = et.getMinutes();
  const mins = h * 60 + m;
  const day = et.getDay(); // 0=Sun, 6=Sat

  const easternTime = et.toLocaleString("en-US", {
    weekday: "short", year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  });

  if (day === 0 || day === 6) return { easternTime, session: "closed" };
  if (mins >= 240 && mins < 570) return { easternTime, session: "pre-market" };
  if (mins >= 570 && mins < 960) return { easternTime, session: "regular" };
  if (mins >= 960 && mins < 1200) return { easternTime, session: "after-hours" };
  return { easternTime, session: "closed" };
}

export function getStatus() {
  const ibkr = getConnectionStatus();
  const { easternTime, session } = getMarketSession();
  return {
    status: "ready",
    easternTime,
    marketSession: session,
    marketData: "yahoo-finance (always available)",
    screener: "yahoo-finance (always available)",
    ibkr: {
      connected: ibkr.connected,
      host: ibkr.host,
      port: ibkr.port,
      clientId: ibkr.clientId,
      note: ibkr.connected
        ? "Account data available"
        : "Start TWS/Gateway for account data (positions, PnL)",
    },
    timestamp: new Date().toISOString(),
  };
}
