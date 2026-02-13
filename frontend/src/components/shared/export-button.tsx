"use client";

import { useState, useRef, useEffect } from "react";
import { Download, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportToCsv, exportToJson } from "@/lib/utils/export";
import { cn } from "@/lib/utils";

interface ExportButtonProps {
  data: Record<string, unknown>[];
  filename: string; // without extension
}

export function ExportButton({ data, filename }: ExportButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleExportCsv = () => {
    exportToCsv(data, filename);
    setIsOpen(false);
  };

  const handleExportJson = () => {
    exportToJson(data, filename);
    setIsOpen(false);
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2"
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Download className="size-4" />
        <span>Export</span>
        <ChevronDown
          className={cn(
            "size-3 transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 mt-2 w-36 origin-top-right rounded-md border border-border bg-card p-1 shadow-md ring-1 ring-black/5 focus:outline-none z-50 animate-in fade-in zoom-in duration-100"
          role="menu"
          aria-orientation="vertical"
        >
          <button
            className="flex w-full items-center rounded-sm px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            role="menuitem"
            onClick={handleExportCsv}
          >
            Export CSV
          </button>
          <button
            className="flex w-full items-center rounded-sm px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            role="menuitem"
            onClick={handleExportJson}
          >
            Export JSON
          </button>
        </div>
      )}
    </div>
  );
}
