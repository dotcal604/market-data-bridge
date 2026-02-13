"use client";

import { useEffect, useState, useCallback } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEvalFilters, type EvalFilterState } from "@/lib/stores/eval-filters";

interface EvalFiltersProps {
  onFilterChange: (filters: EvalFilterState) => void;
}

export function EvalFilters({ onFilterChange }: EvalFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const filters = useEvalFilters();
  
  // Local state for debounced symbol search
  const [symbolInput, setSymbolInput] = useState(filters.symbol);
  
  // Initialize filters from URL on mount
  useEffect(() => {
    const symbol = searchParams.get("symbol") || "";
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const scoreMin = parseInt(searchParams.get("scoreMin") || "0", 10);
    const scoreMax = parseInt(searchParams.get("scoreMax") || "100", 10);
    const shouldTradeParam = searchParams.get("shouldTrade");
    const shouldTrade = shouldTradeParam === null ? null : shouldTradeParam === "true";
    
    filters.setSymbol(symbol);
    filters.setDateFrom(dateFrom);
    filters.setDateTo(dateTo);
    filters.setScoreRange(scoreMin, scoreMax);
    filters.setShouldTrade(shouldTrade);
    setSymbolInput(symbol);
  }, []); // Only run on mount
  
  // Debounce symbol input
  useEffect(() => {
    const timer = setTimeout(() => {
      const uppercased = symbolInput.toUpperCase();
      filters.setSymbol(uppercased);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [symbolInput]);
  
  // Sync filters to URL and notify parent
  useEffect(() => {
    const params = new URLSearchParams();
    
    if (filters.symbol) params.set("symbol", filters.symbol);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    if (filters.scoreMin !== 0) params.set("scoreMin", filters.scoreMin.toString());
    if (filters.scoreMax !== 100) params.set("scoreMax", filters.scoreMax.toString());
    if (filters.shouldTrade !== null) params.set("shouldTrade", filters.shouldTrade.toString());
    
    const queryString = params.toString();
    const newUrl = queryString ? `?${queryString}` : window.location.pathname;
    router.replace(newUrl, { scroll: false });
    
    onFilterChange(filters);
  }, [
    filters.symbol,
    filters.dateFrom,
    filters.dateTo,
    filters.scoreMin,
    filters.scoreMax,
    filters.shouldTrade,
  ]);
  
  const handleClearFilters = useCallback(() => {
    filters.clearFilters();
    setSymbolInput("");
  }, []);
  
  const handleScoreRangeChange = useCallback((values: number[]) => {
    filters.setScoreRange(values[0], values[1]);
  }, []);
  
  const handleShouldTradeChange = useCallback((value: string) => {
    if (value === "all") {
      filters.setShouldTrade(null);
    } else {
      filters.setShouldTrade(value === "yes");
    }
  }, []);
  
  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-end gap-4">
        {/* Symbol Search */}
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Symbol
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search symbol..."
              value={symbolInput}
              onChange={(e) => setSymbolInput(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        
        {/* Date From */}
        <div className="flex-1 min-w-[150px]">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            From Date
          </label>
          <Input
            type="date"
            value={filters.dateFrom || ""}
            onChange={(e) => filters.setDateFrom(e.target.value || null)}
          />
        </div>
        
        {/* Date To */}
        <div className="flex-1 min-w-[150px]">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            To Date
          </label>
          <Input
            type="date"
            value={filters.dateTo || ""}
            onChange={(e) => filters.setDateTo(e.target.value || null)}
          />
        </div>
        
        {/* Should Trade */}
        <div className="flex-1 min-w-[150px]">
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
            Should Trade
          </label>
          <Select
            value={
              filters.shouldTrade === null
                ? "all"
                : filters.shouldTrade
                ? "yes"
                : "no"
            }
            onValueChange={handleShouldTradeChange}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="yes">Yes</SelectItem>
              <SelectItem value="no">No</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        {/* Clear Button */}
        <div>
          <Button
            variant="outline"
            size="default"
            onClick={handleClearFilters}
            className="h-9"
          >
            <X className="h-4 w-4 mr-2" />
            Clear
          </Button>
        </div>
      </div>
      
      {/* Score Range Slider */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Score Range
          </label>
          <span className="text-xs font-mono text-muted-foreground">
            {filters.scoreMin} - {filters.scoreMax}
          </span>
        </div>
        <Slider
          min={0}
          max={100}
          step={1}
          value={[filters.scoreMin, filters.scoreMax]}
          onValueChange={handleScoreRangeChange}
          className="w-full"
        />
      </div>
    </div>
  );
}
