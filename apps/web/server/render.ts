/**
 * SVG → PNG with resvg (WebAssembly, so it runs the same locally and in a Vercel function). The
 * wasm and the fonts are found next to the bundled function (scripts/vercel-output.mjs copies them
 * there) or, in development, in node_modules and server/fonts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg, initWasm } from '@resvg/resvg-wasm';
import { MONO } from './svg';

const here = dirname(fileURLToPath(import.meta.url));
const FONT_FILES = ['SpaceGrotesk-Bold.ttf', 'SpaceMono-Regular.ttf', 'SpaceMono-Bold.ttf'];

function firstExisting(paths: string[]): string {
  const p = paths.find((x) => existsSync(x));
  if (!p) throw new Error(`Missing file (looked in ${paths.join(', ')})`);
  return p;
}

let ready: Promise<Uint8Array[]> | null = null;

function load(): Promise<Uint8Array[]> {
  ready ??= (async () => {
    const wasm = firstExisting([join(here, 'index_bg.wasm'), (() => {
      try {
        return createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm');
      } catch {
        return '';
      }
    })()]);
    await initWasm(readFileSync(wasm));
    return FONT_FILES.map((f) => new Uint8Array(readFileSync(firstExisting([join(here, 'fonts', f), join(here, '../server/fonts', f)]))));
  })();
  return ready;
}

async function rendered(svg: string, width?: number) {
  const fontBuffers = await load();
  const r = new Resvg(svg, {
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: MONO },
    fitTo: width ? { mode: 'width', value: width } : { mode: 'original' },
  });
  return r.render();
}

/** Render an SVG to PNG at `width` pixels wide. */
export async function renderPng(svg: string, width?: number): Promise<Uint8Array> {
  return (await rendered(svg, width)).asPng();
}

/** Render an SVG to raw RGBA pixels (for JPEG encoding). */
export async function renderRgba(svg: string, width?: number): Promise<{ data: Uint8Array; width: number; height: number }> {
  const img = await rendered(svg, width);
  return { data: img.pixels, width: img.width, height: img.height };
}
