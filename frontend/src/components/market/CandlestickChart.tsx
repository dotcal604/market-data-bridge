"use client";

import { useRef, useEffect, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
  ColorType,
} from "lightweight-charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useHistoricalBars } from "@/lib/hooks/use-market";
import { TimeframeSelector, type Timeframe } from "./TimeframeSelector";

interface CandlestickChartProps {
  symbol: string | null;
}

const PERIOD_CONFIG: Record<Timeframe, { period: string; interval: string }> = {
  "1D": { period: "1d", interval: "5m" },
  "5D": { period: "5d", interval: "15m" },
  "1M": { period: "1mo", interval: "1d" },
  "3M": { period: "3mo", interval: "1d" },
  "1Y": { period: "1y", interval: "1d" },
};

export function CandlestickChart({ symbol }: CandlestickChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<Timeframe>("3M");

  const config = PERIOD_CONFIG[selectedPeriod];
  const { data, isLoading, error } = useHistoricalBars(
    symbol,
    config.period,
    config.interval
  );

  // Create chart on mount
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#888",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "rgba(255, 255, 255, 0.04)" },
        horzLines: { color: "rgba(255, 255, 255, 0.04)" },
      },
      crosshair: {
        mode: 0, // Normal crosshair
        vertLine: { color: "rgba(255, 255, 255, 0.2)", style: 2 },
        horzLine: { color: "rgba(255, 255, 255, 0.2)", style: 2 },
      },
      rightPriceScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: "rgba(255, 255, 255, 0.1)",
        timeVisible: selectedPeriod === "1D" || selectedPeriod === "5D",
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#26a69a",
      downColor: "#ef5350",
      borderDownColor: "#ef5350",
      borderUpColor: "#26a69a",
      wickDownColor: "#ef5350",
      wickUpColor: "#26a69a",
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });

    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // Resize observer for responsive sizing
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width } = entry.contentRect;
        if (width > 0) {
          chart.applyOptions({ width });
        }
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []); // Chart created once

  // Update timeScale visibility when period changes
  useEffect(() => {
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({
        timeVisible: selectedPeriod === "1D" || selectedPeriod === "5D",
      });
    }
  }, [selectedPeriod]);

  // Update data when it changes
  useEffect(() => {
    if (!data?.bars || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    const candleData: CandlestickData[] = data.bars.map((bar) => ({
      time: (new Date(bar.time).getTime() / 1000) as Time,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
    }));

    const volumeData: HistogramData[] = data.bars.map((bar) => ({
      time: (new Date(bar.time).getTime() / 1000) as Time,
      value: bar.volume,
      color: bar.close >= bar.open
        ? "rgba(38, 166, 154, 0.4)"
        : "rgba(239, 83, 80, 0.4)",
    }));

    candleSeriesRef.current.setData(candleData);
    volumeSeriesRef.current.setData(volumeData);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  if (!symbol) return null;

  if (error) {
    return (
      <Card>
        <CardHeader><CardTitle>Price Chart</CardTitle></CardHeader>
        <CardContent>
          <div className="flex h-[400px] items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Failed to load chart data: {error.message}
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Calculate header stats from data
  const lastBar = data?.bars[data.bars.length - 1];
  const firstBar = data?.bars[0];
  const totalChange = lastBar && firstBar
    ? ((lastBar.close - firstBar.close) / firstBar.close) * 100
    : 0;
  const changeColor = totalChange >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Price Chart</CardTitle>
            {lastBar && (
              <p className="mt-1 text-sm text-muted-foreground">
                <span className="font-mono">{symbol}</span>
                <span className="mx-2">&bull;</span>
                <span className="font-mono">${lastBar.close.toFixed(2)}</span>
                <span className={`ml-2 font-mono ${changeColor}`}>
                  {totalChange >= 0 ? "+" : ""}
                  {totalChange.toFixed(2)}%
                </span>
              </p>
            )}
          </div>
          <TimeframeSelector selected={selectedPeriod} onChange={setSelectedPeriod} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-[400px] w-full" />
        ) : (
          <div ref={containerRef} style={{ height: 400 }} />
        )}
      </CardContent>
    </Card>
  );
}
