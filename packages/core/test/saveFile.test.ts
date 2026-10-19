import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { writeWhole } from '../scripts/saveFile';

describe('saving a file the scheduled job publishes', () => {
  it('writes it whole, and replaces the one before it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prism-save-'));
    const path = join(dir, 'launch-xray.json.gz');
    writeWhole(path, gzipSync('first'));
    expect(gunzipSync(readFileSync(path)).toString()).toBe('first');
    writeWhole(path, gzipSync('second'));
    expect(gunzipSync(readFileSync(path)).toString()).toBe('second');
    // nothing half-written is left lying about for the publish step to pick up
    expect(readdirSync(dir)).toEqual(['launch-xray.json.gz']);
  });

  it('leaves the file that is already there alone when the new one can’t be written', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prism-save-'));
    const path = join(dir, 'launches.json.gz');
    writeWhole(path, gzipSync('the one already published'));
    // something else holding the temporary name makes the write fail part-way
    mkdirSync(`${path}.part`);
    expect(() => writeWhole(path, gzipSync('the new one'))).toThrow();
    expect(gunzipSync(readFileSync(path)).toString()).toBe('the one already published');
  });
});
