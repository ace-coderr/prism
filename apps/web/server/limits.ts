/**
 * Limits for the routes someone could call over and over.
 *
 * Every route is a GET that the CDN caches by its whole URL, so a script (or a bug) that adds a
 * changing query to each request gets a fresh function run, and fresh CPU, every time. The CDN
 * can't stop that; this does, per instance: a small fixed-window counter per client. It is
 * deliberately simple. It isn't a security boundary (a second instance has its own count), it keeps
 * one client from using a function's whole CPU, which is what costs money here.
 */
import type { IncomingMessage } from 'node:http';

const MAX_CLIENTS = 5_000;

export class Limiter {
  private hits = new Map<string, { n: number; reset: number }>();

  constructor(
    readonly max: number,
    readonly windowMs: number,
  ) {}

  /** Count one request; false once the client is over its allowance for this window. */
  take(client: string, now = Date.now()): boolean {
    let h = this.hits.get(client);
    if (!h || now >= h.reset) {
      if (this.hits.size >= MAX_CLIENTS) this.prune(now);
      h = { n: 0, reset: now + this.windowMs };
      this.hits.set(client, h);
    }
    return ++h.n <= this.max;
  }

  /** Seconds until this client's window ends. */
  retryAfter(client: string, now = Date.now()): number {
    const h = this.hits.get(client);
    return h ? Math.max(1, Math.ceil((h.reset - now) / 1000)) : 1;
  }

  private prune(now: number) {
    for (const [k, h] of this.hits) if (now >= h.reset) this.hits.delete(k);
    // still full of live windows: forget the oldest half rather than grow
    if (this.hits.size >= MAX_CLIENTS) for (const k of [...this.hits.keys()].slice(0, MAX_CLIENTS / 2)) this.hits.delete(k);
  }
}

/**
 * Who is asking: the address the platform saw, else the socket's.
 *
 * Behind the Cloudflare edge every visitor reaches the origin from Cloudflare's own addresses, so
 * the edge passes the real one in `x-prism-client`, with the shared secret in `x-prism-edge`. It is
 * believed only if EDGE_KEY is set here and matches: anyone else can send those headers too, and
 * would otherwise be able to pick the address their requests are counted under.
 */
export function clientOf(req: Pick<IncomingMessage, 'headers' | 'socket'>, edgeKey: string | undefined = process.env.EDGE_KEY): string {
  const sent = req.headers['x-prism-client'];
  const claimed = (Array.isArray(sent) ? sent[0] : sent)?.trim();
  if (edgeKey && claimed && req.headers['x-prism-edge'] === edgeKey) return claimed.slice(0, 64);
  const forwarded = req.headers['x-forwarded-for'];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
  const real = req.headers['x-real-ip'];
  return first || (Array.isArray(real) ? real[0] : real) || req.socket?.remoteAddress || 'unknown';
}
