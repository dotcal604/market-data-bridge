"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { evalClient } from "../api/eval-client";

interface WeightTunerWeights {
  claude: number;
  gpt4o: number;
  gemini: number;
  k: number;
}

interface SimulationResult {
  simulated_weights: WeightTunerWeights;
  evaluations_count: number;
  average_score_delta: number;
}

export function useWeightTuner(initialWeights: WeightTunerWeights) {
  const [weights, setWeights] = useState<WeightTunerWeights>(initialWeights);
  const [simulationResult, setSimulationResult] = useState<SimulationResult | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const simulate = useCallback(async (newWeights: WeightTunerWeights) => {
    try {
      setIsSimulating(true);
      setError(null);
      const response = await evalClient.simulateWeights(newWeights);
      setSimulationResult(response.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
      setSimulationResult(null);
    } finally {
      setIsSimulating(false);
    }
  }, []);

  const debouncedSimulate = useCallback((newWeights: WeightTunerWeights) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    timeoutRef.current = setTimeout(() => {
      void simulate(newWeights);
    }, 300);
  }, [simulate]);

  const updateWeights = useCallback((newWeights: WeightTunerWeights) => {
    setWeights(newWeights);
    debouncedSimulate(newWeights);
  }, [debouncedSimulate]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return {
    weights,
    updateWeights,
    simulationResult,
    isSimulating,
    error,
  };
}
