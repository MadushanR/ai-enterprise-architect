/**
 * lib/with-retry.ts
 * Shared exponential-backoff retry wrapper for watsonx API calls.
 *
 * watsonx returns HTTP 429 when the per-minute token quota is exhausted.
 * The SDK surfaces this as an error with `.status` or `.statusCode` === 429.
 * A 403 with body containing "token_quota_reached" is treated identically
 * (watsonx Lite tier maps quota exhaustion to 403).
 *
 * Strategy: up to `maxAttempts` tries, starting at `initialDelayMs` and
 * doubling each time, capped at `maxDelayMs`.
 */

/** Sleep for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRateLimitError(err: unknown): boolean {
  const e = err as { status?: number; statusCode?: number; message?: string };
  const status = e?.status ?? e?.statusCode;
  if (status === 429) return true;
  // watsonx Lite: 403 token_quota_reached
  if (status === 403 && typeof e?.message === "string" &&
      e.message.toLowerCase().includes("quota")) return true;
  return false;
}

/**
 * Run `fn`, retrying on 429 / quota-exhausted errors with exponential backoff.
 * Throws on the last attempt if the error persists, or immediately for any
 * non-rate-limit error.
 *
 * @param fn            Async function to call (will be called up to maxAttempts times)
 * @param label         Label used in console.warn (e.g. model name or route)
 * @param maxAttempts   Maximum number of attempts (default 4 → 3 retries)
 * @param initialDelayMs Starting back-off delay in ms (default 1 000)
 * @param maxDelayMs    Back-off ceiling in ms (default 16 000)
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
  maxAttempts  = 4,
  initialDelayMs = 1_000,
  maxDelayMs     = 16_000
): Promise<T> {
  let delay = initialDelayMs;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isRateLimitError(err) || attempt === maxAttempts) throw err;
      console.warn(
        `[withRetry][${label}] 429/quota — retrying in ${delay}ms ` +
        `(attempt ${attempt}/${maxAttempts})`
      );
      await sleep(delay);
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }
  // unreachable — satisfies TypeScript
  throw new Error(`[withRetry][${label}] exhausted ${maxAttempts} attempts`);
}
