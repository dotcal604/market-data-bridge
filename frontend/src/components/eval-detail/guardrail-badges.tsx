"use client";

import { Badge } from "@/components/ui/badge";
import { Shield, ShieldCheck, ShieldX } from "lucide-react";

interface Props {
  allowed: boolean;
  prefilterPassed: boolean;
  flags: string[];
}

export function GuardrailBadges({ allowed, prefilterPassed, flags }: Props) {
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-1.5">
        {allowed ? (
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
        ) : (
          <ShieldX className="h-4 w-4 text-red-400" />
        )}
        <Badge variant={allowed ? "default" : "destructive"} className="text-xs">
          {allowed ? "GUARDRAIL PASSED" : "GUARDRAIL BLOCKED"}
        </Badge>
      </div>

      <Badge variant={prefilterPassed ? "outline" : "destructive"} className="text-xs">
        {prefilterPassed ? "Prefilter OK" : "Prefilter Failed"}
      </Badge>

      {flags.length > 0 && (
        <div className="flex gap-1.5">
          {flags.map((flag) => (
            <Badge key={flag} variant="secondary" className="font-mono text-[10px]">
              {flag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
