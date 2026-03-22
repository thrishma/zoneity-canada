/**
 * In-memory sliding-window rate limiter.
 * Suitable for single-instance dev/hackathon deployments.
 * For multi-instance prod: swap the Map for Redis.
 */

interface Window {
  timestamps: number[];
}

const store = new Map<string, Window>();

// Clean up old keys every 10 minutes to avoid memory leak
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [key, win] of store) {
    const fresh = win.timestamps.filter((t) => t > cutoff);
    if (fresh.length === 0) {
      store.delete(key);
    } else {
      win.timestamps = fresh;
    }
  }
}, 10 * 60 * 1000);

/**
 * Returns true if the key is within limits, false if rate-limited.
 * @param key       Identifier (e.g. IP address)
 * @param maxCalls  Max allowed calls within the window
 * @param windowMs  Window size in milliseconds
 */
export function checkRateLimit(key: string, maxCalls: number, windowMs: number): boolean {
  const now = Date.now();
  const cutoff = now - windowMs;
  const win = store.get(key) ?? { timestamps: [] };
  win.timestamps = win.timestamps.filter((t) => t > cutoff);
  if (win.timestamps.length >= maxCalls) {
    store.set(key, win);
    return false; // rate limited
  }
  win.timestamps.push(now);
  store.set(key, win);
  return true; // allowed
}

/** Extract the real client IP from Next.js request headers */
export function getClientIp(req: Request): string {
  const xff = (req as { headers: Headers }).headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return "unknown";
}
