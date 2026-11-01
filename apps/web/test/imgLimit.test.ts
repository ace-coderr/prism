import { describe, expect, it } from 'vitest';
import handler from '../server/img';

/** The picture route is a function run for every picture the CDN doesn't hold: one client can't ask for all of them. */
describe('pictures', () => {
  const ask = async (client: string, url = '/img/t/not-an-address.png') => {
    const headers: Record<string, string> = {};
    const res = { statusCode: 0, setHeader: (k: string, v: string) => void (headers[k.toLowerCase()] = v), end() {} };
    await handler({ url, method: 'GET', headers: { 'x-forwarded-for': client }, socket: {} } as never, res as never);
    return { status: res.statusCode, headers };
  };

  it('are limited per client, with when to try again, and others are unaffected', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 245; i++) codes.push((await ask('198.51.100.9')).status);
    expect(codes.slice(0, 240).every((c) => c === 400)).toBe(true); // not an address: refused without any work
    expect(codes.slice(240)).toEqual([429, 429, 429, 429, 429]);
    const blocked = await ask('198.51.100.9');
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(blocked.headers['cache-control']).toBe('no-store');
    expect((await ask('198.51.100.10')).status).toBe(400);
  });
});
