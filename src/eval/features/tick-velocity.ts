/**
 * Zero-Allocation Tick Velocity & Acceleration Calculator
 * 
 * Implements a ring buffer (circular buffer) using Float64Array to store tick prices
 * and calculate the first and second derivatives of price (Velocity & Acceleration)
 * without triggering Garbage Collection (GC) during market hours.
 */

export class TickVelocity {
  private readonly capacity: number;
  private readonly prices: Float64Array;
  private readonly timestamps: Float64Array;
  private head: number = 0;
  private count: number = 0;

  /**
   * @param windowSize The number of ticks to keep in memory (e.g., 100).
   */
  constructor(windowSize: number = 100) {
    this.capacity = windowSize;
    // Pre-allocate memory to avoid runtime allocation
    this.prices = new Float64Array(windowSize);
    this.timestamps = new Float64Array(windowSize);
  }

  /**
   * Push a new tick price. O(1) complexity.
   * Overwrites the oldest value when full.
   * @param price Tick price
   * @param timestamp Tick timestamp (ms)
   */
  public push(price: number, timestamp: number): void {
    this.prices[this.head] = price;
    this.timestamps[this.head] = timestamp;

    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /**
   * Calculate the average velocity over the last `lookback` ticks.
   * Velocity v = ΔP / Δt (price change per millisecond)
   * 
   * @param lookback Number of ticks to look back. Must be < capacity.
   * @returns Velocity (price/ms)
   */
  public getVelocity(lookback: number = 10): number {
    if (this.count < lookback + 1) return 0;

    const idxCurrent = (this.head - 1 + this.capacity) % this.capacity;
    const idxPast = (this.head - 1 - lookback + this.capacity) % this.capacity;

    const pCurrent = this.prices[idxCurrent];
    const pPast = this.prices[idxPast];
    
    const tCurrent = this.timestamps[idxCurrent];
    const tPast = this.timestamps[idxPast];

    const dt = tCurrent - tPast;
    if (dt <= 0) return 0; // Prevent division by zero

    return (pCurrent - pPast) / dt;
  }

  /**
   * Calculate the instantaneous acceleration (2nd derivative).
   * Acceleration a = Δv / Δt
   * 
   * Uses a central difference approximation if possible, or simple backward difference.
   * a ≈ (P_t - 2P_{t-1} + P_{t-2}) / dt^2 (assuming constant dt, else (v2 - v1)/dt)
   * @param lookback Window size for velocity segments
   * @returns Acceleration (price/ms^2)
   */
  public getAcceleration(lookback: number = 10): number {
    if (this.count < (lookback * 2) + 1) return 0;

    // v_recent = Velocity over [t, t-lookback]
    // v_prev = Velocity over [t-lookback, t-2*lookback]
    
    const idxCurrent = (this.head - 1 + this.capacity) % this.capacity;
    const idxMid = (this.head - 1 - lookback + this.capacity) % this.capacity;
    const idxOld = (this.head - 1 - (2 * lookback) + this.capacity) % this.capacity;

    const pCurrent = this.prices[idxCurrent];
    const pMid = this.prices[idxMid];
    const pOld = this.prices[idxOld];

    const tCurrent = this.timestamps[idxCurrent];
    const tMid = this.timestamps[idxMid];
    const tOld = this.timestamps[idxOld];

    // Velocity 1 (Recent)
    const dt1 = tCurrent - tMid;
    if (dt1 <= 0) return 0;
    const v1 = (pCurrent - pMid) / dt1;

    // Velocity 2 (Previous)
    const dt2 = tMid - tOld;
    if (dt2 <= 0) return 0;
    const v2 = (pMid - pOld) / dt2;

    // Acceleration
    // Time delta for acceleration is the gap between the midpoints of the two velocity windows?
    // Simply: a = (v1 - v2) / ((dt1 + dt2) / 2)
    const avgDt = (dt1 + dt2) / 2;
    
    return (v1 - v2) / avgDt;
  }

  /**
   * Reset the buffer.
   */
  public reset(): void {
    this.head = 0;
    this.count = 0;
    // No need to zero out arrays, they will be overwritten
  }
}
