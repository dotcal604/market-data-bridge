import React, { useRef, useEffect, useCallback } from 'react';

interface OHLCV {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CanvasPriceChartProps {
  symbol: string;
  width: number;
  height: number;
}

const CanvasPriceChart: React.FC<CanvasPriceChartProps> = ({ symbol, width, height }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const dataRef = useRef<OHLCV[]>([]);
  
  // Rendering State
  const viewState = useRef({
    offset: 0, // Candles from right edge
    zoom: 10,  // Pixels per candle width
  });

  // 1. Initialize Worker
  useEffect(() => {
    workerRef.current = new Worker(new URL('../../lib/workers/chart.worker.ts', import.meta.url));
    
    workerRef.current.onmessage = (e) => {
      const { type, payload } = e.data;
      if (type === 'UPDATE_CANDLE' || type === 'UPDATE_PARTIAL') {
        // Append or update last candle
        // For simplicity in this demo, we just push/replace logic here or let worker manage full array?
        // Let's assume worker sends just the update, we maintain array here for rendering
        // In a real optimized setup, we might use SharedArrayBuffer.
        
        const last = dataRef.current[dataRef.current.length - 1];
        if (last && last.time === payload.time) {
          dataRef.current[dataRef.current.length - 1] = payload;
        } else {
          dataRef.current.push(payload);
        }
        
        // Trigger render
        requestAnimationFrame(draw);
      }
    };

    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  // 2. The Render Loop (60fps Target)
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const ctx = canvas.getContext('2d', { alpha: false }); // Optimize for no transparency
    if (!ctx) return;

    // Clear Screen
    ctx.fillStyle = '#1e1e1e'; // Dark Background
    ctx.fillRect(0, 0, width, height);

    const candles = dataRef.current;
    if (candles.length === 0) return;

    // Viewport Calculation
    const { offset, zoom } = viewState.current;
    const visibleCandles = Math.ceil(width / zoom);
    const startIndex = Math.max(0, candles.length - 1 - offset - visibleCandles);
    const endIndex = Math.min(candles.length, startIndex + visibleCandles + 1);
    
    // Auto-Scale Price Axis
    let minPrice = Infinity;
    let maxPrice = -Infinity;
    
    for (let i = startIndex; i < endIndex; i++) {
      minPrice = Math.min(minPrice, candles[i].low);
      maxPrice = Math.max(maxPrice, candles[i].high);
    }
    
    const priceRange = maxPrice - minPrice || 1;
    const pxPerPrice = (height - 40) / priceRange; // 40px padding

    // Draw Candles
    ctx.lineWidth = 1;
    
    for (let i = startIndex; i < endIndex; i++) {
      const candle = candles[i];
      const x = width - ((candles.length - 1 - i + offset) * zoom) - (zoom / 2);
      
      const yOpen = height - ((candle.open - minPrice) * pxPerPrice) - 20;
      const yClose = height - ((candle.close - minPrice) * pxPerPrice) - 20;
      const yHigh = height - ((candle.high - minPrice) * pxPerPrice) - 20;
      const yLow = height - ((candle.low - minPrice) * pxPerPrice) - 20;
      
      const isUp = candle.close >= candle.open;
      ctx.fillStyle = isUp ? '#26a69a' : '#ef5350';
      ctx.strokeStyle = isUp ? '#26a69a' : '#ef5350';
      
      // Wick
      ctx.beginPath();
      ctx.moveTo(x, yHigh);
      ctx.lineTo(x, yLow);
      ctx.stroke();
      
      // Body
      const bodyHeight = Math.max(1, Math.abs(yClose - yOpen));
      ctx.fillRect(x - (zoom * 0.4), Math.min(yOpen, yClose), zoom * 0.8, bodyHeight);
    }
    
    // Draw Price Axis (Simple)
    ctx.fillStyle = '#ffffff';
    ctx.font = '10px monospace';
    ctx.fillText(maxPrice.toFixed(2), width - 50, 20);
    ctx.fillText(minPrice.toFixed(2), width - 50, height - 10);

  }, [width, height]);

  // Initial Draw
  useEffect(() => {
    requestAnimationFrame(draw);
  }, [draw]);

  return (
    <canvas 
      ref={canvasRef} 
      width={width} 
      height={height} 
      style={{ cursor: 'crosshair' }}
    />
  );
};

export default CanvasPriceChart;
