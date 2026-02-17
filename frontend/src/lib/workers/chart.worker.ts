/**
 * High-Performance Chart Data Worker
 * 
 * Responsibilities:
 * 1. Offload WebSocket JSON parsing from the main thread.
 * 2. Downsample high-frequency ticks into OHLCV bars (Tumbling Window).
 * 3. Maintain a ring buffer of the latest 10,000 candles for rendering.
 */

// Define types for incoming messages
type WorkerMessage = 
  | { type: 'TICK'; payload: RawTick }
  | { type: 'INIT'; payload: { timeframe: number } }; // timeframe in ms

interface RawTick {
  price: number;
  size: number;
  timestamp: number;
}

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

let currentBar: OHLCV | null = null;
let timeframeMs = 60000; // Default 1 minute
const MAX_CANDLES = 10000;
let candles: OHLCV[] = [];

self.onmessage = (e: MessageEvent<WorkerMessage>) => {
  const { type, payload } = e.data;

  switch (type) {
    case 'INIT':
      timeframeMs = payload.timeframe;
      candles = []; // Reset on timeframe change
      currentBar = null;
      break;

    case 'TICK':
      processTick(payload);
      break;
  }
};

/**
 * Tumbling Window Aggregation Algorithm
 * Complexity: O(1) per tick
 */
function processTick(tick: RawTick) {
  const tickTime = tick.timestamp;
  
  // Align timestamp to the start of the bucket
  const bucketStart = Math.floor(tickTime / timeframeMs) * timeframeMs;

  if (!currentBar) {
    // Initialize first bar
    currentBar = {
      time: bucketStart,
      open: tick.price,
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.size
    };
  } else if (bucketStart > currentBar.time) {
    // Close current bar and start new one
    pushCandle(currentBar);
    
    // Send update to main thread
    self.postMessage({ type: 'UPDATE_CANDLE', payload: currentBar });
    
    // Start new bar
    currentBar = {
      time: bucketStart,
      open: tick.price, // Gap handling: could use prev close
      high: tick.price,
      low: tick.price,
      close: tick.price,
      volume: tick.size
    };
  } else {
    // Update current bar
    currentBar.high = Math.max(currentBar.high, tick.price);
    currentBar.low = Math.min(currentBar.low, tick.price);
    currentBar.close = tick.price;
    currentBar.volume += tick.size;
    
    // Optional: Throttle "partial" updates to 60fps (16ms) to save bandwidth
    // For now, we send every update for max responsiveness
    self.postMessage({ type: 'UPDATE_PARTIAL', payload: currentBar });
  }
}

function pushCandle(bar: OHLCV) {
  candles.push(bar);
  if (candles.length > MAX_CANDLES) {
    // Efficiently remove oldest
    candles.shift(); 
  }
}
