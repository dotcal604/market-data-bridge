"use client";

import { useState, useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { useSymbolSearch } from "@/lib/hooks/use-market";
import { cn } from "@/lib/utils";

interface SymbolSearchProps {
  onSelect: (symbol: string) => void;
  className?: string;
}

export function SymbolSearch({ onSelect, className }: SymbolSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useSymbolSearch(query);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (symbol: string) => {
    onSelect(symbol);
    setQuery(""); // Clear search after selection
    setIsOpen(false);
  };

  const handleClear = () => {
    setQuery("");
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search symbols (e.g., AAPL, TSLA)..."
          className="h-10 w-full rounded-md border border-border bg-background pl-10 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-400"
        />
        {query && (
          <button
            onClick={handleClear}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && query.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-card shadow-lg">
          {isLoading && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              Searching...
            </div>
          )}

          {!isLoading && data && data.results.length === 0 && (
            <div className="px-4 py-3 text-sm text-muted-foreground">
              No results found
            </div>
          )}

          {!isLoading && data && data.results.length > 0 && (
            <div className="max-h-64 overflow-y-auto">
              {data.results.map((result) => (
                <button
                  key={result.symbol}
                  onClick={() => handleSelect(result.symbol)}
                  className="w-full border-b border-border px-4 py-2 text-left transition-colors hover:bg-accent last:border-b-0"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {result.symbol}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {result.exchDisp}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {result.name}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
