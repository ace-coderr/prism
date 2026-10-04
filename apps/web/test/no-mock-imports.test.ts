import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * PRISM shows real Robinhood Chain Testnet data only. This fails if production code
 * (the web app or the shared core package) imports a mock / sample / fixture module,
 * or if such a module exists among its sources.
 */

const root = fileURLToPath(new URL('../../..', import.meta.url));
const SOURCES = ['apps/web/src', 'packages/core/src'];
const MOCKISH = /(^|[/\\._-])(mocks?|samples?|fixtures?|fakes?|dummy)([/\\._-]|$)/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|jsx)$/.test(name) ? [p] : [];
  });
}

const sources = SOURCES.flatMap((d) => files(join(root, d)));

/** Every module specifier in a file: static imports, re-exports and dynamic import(). */
function specifiers(code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1]!);
  for (const m of code.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]!);
  return out;
}

describe('no mock data in production code', () => {
  it('finds the sources it checks', () => {
    expect(sources.length).toBeGreaterThan(20);
  });

  it('no source file is a mock / sample module', () => {
    const bad = sources.map((f) => relative(root, f)).filter((f) => MOCKISH.test(f));
    expect(bad).toEqual([]);
  });

  it('no source file imports a mock / sample module', () => {
    const bad: string[] = [];
    for (const f of sources) {
      for (const spec of specifiers(readFileSync(f, 'utf8'))) {
        if (MOCKISH.test(spec)) bad.push(`${relative(root, f)} → ${spec}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('the check itself catches a mock import', () => {
    expect(specifiers("import { X } from '../data/mock';").some((s) => MOCKISH.test(s))).toBe(true);
    expect(specifiers("const m = await import('./samples/basket');").some((s) => MOCKISH.test(s))).toBe(true);
    expect(specifiers("import { useQuery } from '@tanstack/react-query';").some((s) => MOCKISH.test(s))).toBe(false);
  });
});
