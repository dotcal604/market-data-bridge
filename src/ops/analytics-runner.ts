import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import { logger } from "../logging.js";
import { insertAnalyticsJob, updateAnalyticsJob } from "../db/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const analyticsDir = path.join(__dirname, "../../analytics");

// Analytics logger
const logAnalytics = logger.child({ subsystem: "analytics" });

// Known Python scripts whitelist (populated at init time)
let knownScripts: Set<string> = new Set();

function loadKnownScripts(): void {
  try {
    if (!fs.existsSync(analyticsDir)) {
      logAnalytics.warn({ analyticsDir }, "Analytics directory not found");
      return;
    }
    const files = fs.readdirSync(analyticsDir);
    const pythonScripts = files.filter((f) => f.endsWith(".py") && !f.startsWith("__"));
    knownScripts = new Set(pythonScripts.map((f) => f.replace(/\.py$/, "")));
    logAnalytics.info({ count: knownScripts.size, scripts: Array.from(knownScripts) }, "Loaded known analytics scripts");
  } catch (err) {
    logAnalytics.error({ err }, "Failed to load known scripts");
  }
}

// Initialize whitelist on module load
loadKnownScripts();

export interface ScriptResult {
  jobId: number;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Run a Python analytics script from the analytics/ directory.
 * 
 * @param scriptName - Name of the script without .py extension (e.g., "recalibrate_weights")
 * @param args - Optional command-line arguments to pass to the script
 * @param timeoutMs - Timeout in milliseconds (default: 5 minutes)
 * @param triggerType - Type of trigger: "manual", "scheduled", "api" (default: "manual")
 * @returns Promise<ScriptResult> with job ID, exit code, stdout/stderr, duration, and timeout flag
 */
export async function runAnalyticsScript(
  scriptName: string,
  args: string[] = [],
  timeoutMs: number = 5 * 60 * 1000, // 5 minutes default
  triggerType: string = "manual"
): Promise<ScriptResult> {
  // Validate script name against whitelist
  if (!knownScripts.has(scriptName)) {
    logAnalytics.error({ scriptName, knownScripts: Array.from(knownScripts) }, "Script not in whitelist");
    throw new Error(`Unknown script: ${scriptName}. Known scripts: ${Array.from(knownScripts).join(", ")}`);
  }

  const scriptPath = path.join(analyticsDir, `${scriptName}.py`);
  if (!fs.existsSync(scriptPath)) {
    logAnalytics.error({ scriptPath }, "Script file not found");
    throw new Error(`Script file not found: ${scriptPath}`);
  }

  // Insert job record
  const jobId = insertAnalyticsJob(scriptName, triggerType);
  logAnalytics.info({ jobId, scriptName, args, timeoutMs }, "Starting analytics script");

  const startTime = Date.now();
  let stdout = "";
  let stderr = "";
  let exitCode: number | null = null;
  let timedOut = false;

  return new Promise((resolve) => {
    // Spawn Python process
    const proc = spawn("python", [scriptPath, ...args], {
      cwd: analyticsDir,
      env: { ...process.env, PYTHONUNBUFFERED: "1" }, // Unbuffered for real-time output
    });

    // Capture stdout
    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      logAnalytics.debug({ jobId, chunk: chunk.slice(0, 200) }, "Script stdout");
    });

    // Capture stderr
    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      logAnalytics.debug({ jobId, chunk: chunk.slice(0, 200) }, "Script stderr");
    });

    // Handle process exit
    proc.on("exit", (code, signal) => {
      exitCode = code;
      const durationMs = Date.now() - startTime;

      if (signal === "SIGTERM" && timedOut) {
        logAnalytics.warn({ jobId, scriptName, durationMs }, "Script timed out");
        updateAnalyticsJob(jobId, {
          status: "timeout",
          exitCode: null,
          stdout,
          stderr: stderr + "\n[Process killed due to timeout]",
          durationMs,
        });
        resolve({ jobId, exitCode: null, stdout, stderr, durationMs, timedOut: true });
      } else if (code === 0) {
        logAnalytics.info({ jobId, scriptName, durationMs }, "Script completed successfully");
        updateAnalyticsJob(jobId, {
          status: "success",
          exitCode: code,
          stdout,
          stderr,
          durationMs,
        });
        resolve({ jobId, exitCode: code, stdout, stderr, durationMs, timedOut: false });
      } else {
        logAnalytics.error({ jobId, scriptName, exitCode: code, durationMs }, "Script failed");
        updateAnalyticsJob(jobId, {
          status: "error",
          exitCode: code,
          stdout,
          stderr,
          durationMs,
        });
        resolve({ jobId, exitCode: code, stdout, stderr, durationMs, timedOut: false });
      }
    });

    // Handle spawn error
    proc.on("error", (err) => {
      const durationMs = Date.now() - startTime;
      logAnalytics.error({ jobId, scriptName, err }, "Failed to spawn script process");
      stderr += `\nSpawn error: ${err.message}`;
      updateAnalyticsJob(jobId, {
        status: "error",
        exitCode: null,
        stdout,
        stderr,
        durationMs,
      });
      resolve({ jobId, exitCode: null, stdout, stderr, durationMs, timedOut: false });
    });

    // Set timeout
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      logAnalytics.warn({ jobId, scriptName, timeoutMs }, "Killing script due to timeout");
      proc.kill("SIGTERM");

      // Force kill after 5s if graceful termination fails
      setTimeout(() => {
        if (!proc.killed) {
          logAnalytics.error({ jobId, scriptName }, "Force killing script (SIGKILL)");
          proc.kill("SIGKILL");
        }
      }, 5000);
    }, timeoutMs);

    // Clear timeout if process exits naturally
    proc.on("exit", () => clearTimeout(timeoutHandle));
  });
}

/**
 * Get list of known analytics scripts (whitelist).
 * @returns Array of script names (without .py extension)
 */
export function getKnownScripts(): string[] {
  return Array.from(knownScripts).sort();
}

/**
 * Refresh the known scripts whitelist from the analytics/ directory.
 * Useful if scripts are added/removed at runtime.
 */
export function refreshKnownScripts(): void {
  loadKnownScripts();
}
