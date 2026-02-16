import { EventName } from "@stoqey/ib";
import { logger } from "../logging.js";
import { getIB, onConnectionRestored } from "./connection.js";
import { getSymbolByTickerId, resubscribeAllActiveSymbols, touchSubscription } from "./subscriptions.js";
import { updateQuote } from "./market-cache.js";

const TICK_BID = 1;
const TICK_ASK = 2;
const TICK_LAST = 4;
const TICK_BID_SIZE = 0;
const TICK_ASK_SIZE = 3;
const TICK_VOLUME = 8;

const log = logger.child({ subsystem: "ibkr-market-stream" });

let initialized = false;

function updateForTicker(tickerId: number, patch: { bid?: number; ask?: number; last?: number; bidSize?: number; askSize?: number; volume?: number }): void {
  const symbol = getSymbolByTickerId(tickerId);
  if (!symbol) return;

  touchSubscription(symbol);
  updateQuote(symbol, { ...patch, timestamp: Date.now() });
}

export function initMarketStream(): void {
  if (initialized) return;
  initialized = true;

  const ib = getIB();

  ib.on(EventName.tickPrice, (tickerId: number, field: number, price: number) => {
    if (field === TICK_BID) updateForTicker(tickerId, { bid: price });
    if (field === TICK_ASK) updateForTicker(tickerId, { ask: price });
    if (field === TICK_LAST) updateForTicker(tickerId, { last: price });
  });

  ib.on(EventName.tickSize, (tickerId: number, field: number | undefined, size: number | undefined) => {
    if (size === undefined) return;
    if (field === TICK_BID_SIZE) updateForTicker(tickerId, { bidSize: size });
    if (field === TICK_ASK_SIZE) updateForTicker(tickerId, { askSize: size });
    if (field === TICK_VOLUME) updateForTicker(tickerId, { volume: size });
  });

  ib.on(EventName.tickGeneric, (tickerId: number, field: number | undefined, value: number | undefined) => {
    if (value === undefined) return;
    if (field === TICK_VOLUME) {
      updateForTicker(tickerId, { volume: value });
      return;
    }
    updateForTicker(tickerId, {});
  });

  onConnectionRestored(() => {
    const count = resubscribeAllActiveSymbols();
    log.info({ count }, "Resubscribed active market data symbols after reconnect");
  });
}
