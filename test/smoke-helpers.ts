import { spawn, type ChildProcess } from "child_process";
import { randomBytes } from "crypto";

export interface BridgeProcess {
  child: ChildProcess;
  port: number;
  apiKey: string;
}

/**
 * Starts the bridge in REST-only mode with a random port.
 * Returns the child process, port, and API key.
 */
export async function startBridge(): Promise<BridgeProcess> {
  // Use random port (let the OS assign one via port 0, then we read it from status)
  const port = 30000 + Math.floor(Math.random() * 10000); // Random port 30000-39999
  const apiKey = randomBytes(16).toString("hex");

  const child = spawn("node", ["build/index.js", "--mode", "rest"], {
    env: {
      ...process.env,
      REST_PORT: port.toString(),
      REST_API_KEY: apiKey,
      NODE_ENV: "test",
      LOG_LEVEL: "error", // Minimize logs during tests
      // Disable IBKR connection attempts
      IBKR_HOST: "127.0.0.1",
      IBKR_PORT: "99999", // Invalid port to ensure no connection
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  // Capture output for debugging
  const output: string[] = [];
  child.stdout?.on("data", (data) => {
    output.push(data.toString());
  });
  child.stderr?.on("data", (data) => {
    output.push(data.toString());
  });

  // If process exits unexpectedly, throw with output
  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      throw new Error(
        `Bridge process exited with code ${code}.\nOutput:\n${output.join("")}`
      );
    }
  });

  return { child, port, apiKey };
}

/**
 * Polls /api/status until the server is ready.
 * Throws if not ready within timeout.
 */
export async function waitForReady(
  port: number,
  apiKey: string,
  timeoutMs = 30000
): Promise<void> {
  const start = Date.now();
  const interval = 100; // Poll every 100ms

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`http://localhost:${port}/api/status`, {
        headers: { "X-API-Key": apiKey },
        signal: AbortSignal.timeout(1000), // 1s timeout per request
      });

      if (response.ok) {
        const data = await response.json();
        if (data.status === "ready") {
          return;
        }
      }
    } catch (err) {
      // Ignore errors and retry
    }

    // Wait before next attempt
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`Bridge did not become ready within ${timeoutMs}ms`);
}

/**
 * Stops the bridge process gracefully with SIGTERM.
 * Falls back to SIGKILL if not stopped within timeout.
 */
export async function stopBridge(
  process: BridgeProcess,
  timeoutMs = 5000
): Promise<void> {
  const { child } = process;

  if (child.killed || child.exitCode !== null) {
    return; // Already stopped
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null) {
        child.kill("SIGKILL"); // Force kill
        reject(new Error("Bridge did not stop gracefully, had to force kill"));
      }
    }, timeoutMs);

    child.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });

    child.kill("SIGTERM"); // Graceful shutdown
  });
}

/**
 * Makes an HTTP request with retries for transient failures.
 */
export async function retryFetch(
  url: string,
  options: RequestInit & { headers: Record<string, string> },
  retries = 3,
  delayMs = 500
): Promise<Response> {
  let lastError: Error | null = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(5000), // 5s timeout
      });
      return response;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < retries - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error("Fetch failed after retries");
}
