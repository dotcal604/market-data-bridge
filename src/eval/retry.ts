import { logger } from "../logging.js";

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; delayMs?: number; label?: string } = {},
): Promise<T> {
  const { retries = 2, delayMs = 500, label = "operation" } = opts;
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        const wait = delayMs * (attempt + 1);
        logger.warn(`${label} attempt ${attempt + 1} failed, retrying in ${wait}ms: ${lastErr.message}`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  throw lastErr!;
}
