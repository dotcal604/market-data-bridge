/**
 * Python Bridge for deep trailing-stop optimization.
 *
 * Shells out to `analytics/holly_exit/scripts/05_run_optimization.py --output-json`
 * and parses the structured JSON result. This replaces the TS optimizer for
 * production-grade parameter sweeps (VectorBT-backed, full price-path simulation).
 *
 * The TS optimizer in trailing-stop-optimizer.ts is kept for quick sub-second
 * MCP queries but is deprecated for deep optimization.
 */

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logging.js";

const log = logger.child({ module: "trailing-stop-python-bridge" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");
const SCRIPT_PATH = path.join(
  PROJECT_ROOT,
  "analytics",
  "holly_exit",
  "scripts",
  "05_run_optimization.py",
);

// ── Types ────────────────────────────────────────────────────────────────

export interface PythonOptimizationResult {
  source: "python";
  symbol: string;
  bestParams: Record<string, unknown>;
  metrics: {
    winRate: number;
    avgR: number;
    profitFactor: number;
    totalTrades: number;
  };
  strategies: Array<{
    name: string;
    params: Record<string, unknown>;
    performance: Record<string, number>;
  }>;
  executionTimeMs: number;
}

// ── Bridge ───────────────────────────────────────────────────────────────

const JSON_START = "---JSON_OUTPUT_START---";
const JSON_END = "---JSON_OUTPUT_END---";

/**
 * Run the Python VectorBT optimizer and return structured results.
 *
 * @param symbol - Holly strategy name to optimize (passed as --strategy).
 *                 Pass `undefined` or `"ALL"` for a global sweep.
 * @param options.timeoutMs - Maximum wall-clock time (default 30 000 ms).
 */
export async function runPythonOptimization(
  symbol: string,
  options?: { timeoutMs?: number },
): Promise<PythonOptimizationResult> {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const start = Date.now();

  const args = [SCRIPT_PATH, "--output-json"];
  if (symbol && symbol !== "ALL") {
    args.push("--strategy", symbol);
  }

  log.info({ symbol, timeoutMs, script: SCRIPT_PATH }, "Spawning Python optimizer");

  return new Promise<PythonOptimizationResult>((resolve, reject) => {
    const proc = spawn("python", args, {
      cwd: path.join(PROJECT_ROOT, "analytics", "holly_exit"),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      log.error({ err, stderr }, "Python optimizer process error");
      reject(new Error(`Python optimizer failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      const elapsed = Date.now() - start;

      if (code !== 0) {
        log.error({ code, stderr, elapsed }, "Python optimizer exited with error");
        reject(new Error(`Python optimizer exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      // Extract JSON between delimiters
      const startIdx = stdout.indexOf(JSON_START);
      const endIdx = stdout.indexOf(JSON_END);

      if (startIdx === -1 || endIdx === -1) {
        log.error({ stdoutLength: stdout.length, elapsed }, "JSON delimiters not found in output");
        reject(new Error("Python optimizer did not produce JSON output"));
        return;
      }

      const jsonStr = stdout.slice(startIdx + JSON_START.length, endIdx).trim();

      try {
        const raw = JSON.parse(jsonStr) as {
          bestOverall: {
            params: Record<string, unknown>;
            performance: Record<string, number>;
          } | null;
          strategies: Array<{
            name: string;
            params: Record<string, unknown>;
            performance: Record<string, number>;
          }>;
        };

        const best = raw.bestOverall ?? raw.strategies[0];

        const result: PythonOptimizationResult = {
          source: "python",
          symbol,
          bestParams: best?.params ?? {},
          metrics: {
            winRate: best?.performance?.winRate ?? 0,
            avgR: best?.performance?.avgR ?? 0,
            profitFactor: best?.performance?.profitFactor ?? 0,
            totalTrades: best?.performance?.totalTrades ?? 0,
          },
          strategies: raw.strategies,
          executionTimeMs: elapsed,
        };

        log.info(
          { symbol, elapsed, strategyCount: raw.strategies.length },
          "Python optimization complete",
        );

        resolve(result);
      } catch (parseErr) {
        log.error({ parseErr, jsonStr: jsonStr.slice(0, 200) }, "Failed to parse optimizer JSON");
        reject(new Error(`Failed to parse Python optimizer output: ${(parseErr as Error).message}`));
      }
    });
  });
}
