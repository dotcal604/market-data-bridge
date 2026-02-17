/**
 * E2E test helpers for starting/stopping the bridge and polling for readiness.
 */
import { spawn, ChildProcess } from "node:child_process";
import { resolve } from "node:path";

export interface BridgeProcess {
  process: ChildProcess;
  port: number;
  apiKey: string;
}

/**
 * Starts the bridge in REST-only mode on a random port.
 * Returns BridgeProcess handle for cleanup.
 */
export async function startBridge(port?: number): Promise<BridgeProcess> {
  const actualPort = port ?? Math.floor(10000 + Math.random() * 50000);
  const apiKey = "test-api-key-" + Math.random().toString(36).slice(2);

  const entryPoint = resolve(process.cwd(), "build", "index.js");

  // Spawn bridge process with --mode rest and env vars
  const env = {
    ...process.env,
    PORT: actualPort.toString(),
    REST_PORT: actualPort.toString(),
    REST_API_KEY: apiKey,
    LOG_LEVEL: "error", // Reduce noise in test output
    // IBKR connection will fail gracefully - bridge continues without it
  };

  const child = spawn("node", [entryPoint, "--mode", "rest"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Collect stderr for debugging if startup fails
  const stderrChunks: Buffer[] = [];
  child.stderr?.on("data", (chunk) => {
    stderrChunks.push(chunk);
  });

  // Forward stdout for debugging (optional)
  child.stdout?.on("data", (chunk) => {
    if (process.env.DEBUG_E2E) {
      process.stdout.write(chunk);
    }
  });

  // Check if process exited prematurely
  child.on("exit", (code, signal) => {
    if (code !== null && code !== 0) {
      const stderr = Buffer.concat(stderrChunks).toString();
      throw new Error(`Bridge exited with code ${code}: ${stderr}`);
    }
    if (signal) {
      throw new Error(`Bridge killed by signal ${signal}`);
    }
  });

  return { process: child, port: actualPort, apiKey };
}

/**
 * Polls GET /api/status until it returns 200 or timeout is reached.
 * Returns true if ready, throws if timeout.
 */
export async function waitForReady(
  port: number,
  apiKey: string,
  timeoutMs = 30_000,
): Promise<void> {
  const startTime = Date.now();
  const url = `http://localhost:${port}/api/status`;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const response = await fetch(url, {
        headers: { "X-API-Key": apiKey },
      });

      if (response.ok) {
        const data = await response.json();
        if (data && typeof data === "object") {
          return; // Ready!
        }
      }
    } catch (err) {
      // Connection refused, retry
    }

    // Wait 100ms before next attempt
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Bridge did not become ready within ${timeoutMs}ms`);
}

/**
 * Stops the bridge process gracefully (SIGTERM) and waits for exit.
 */
export async function stopBridge(bridge: BridgeProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!bridge.process.pid) {
      resolve();
      return;
    }

    const timeout = setTimeout(() => {
      bridge.process.kill("SIGKILL");
      reject(new Error("Bridge did not exit within 5 seconds, killed forcefully"));
    }, 5000);

    bridge.process.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    bridge.process.kill("SIGTERM");
  });
}
