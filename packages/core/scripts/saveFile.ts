/**
 * Saving a file the scheduled job publishes, so a half-written one can never be read or uploaded.
 *
 * These scripts save their progress every few seconds and can be stopped at any moment (a step
 * timeout, a cancelled run). Writing straight to the file would leave a truncated one behind, and
 * the publish step would upload that. The bytes go to a temporary file beside it instead, renamed
 * into place only once they are all there: a rename within a directory either happens or doesn't,
 * so what is on disk is always a whole file, either the new one or the one before it.
 */
import { renameSync, rmSync, writeFileSync } from 'node:fs';

export function writeWhole(path: string, data: Uint8Array): void {
  const part = `${path}.part`;
  try {
    writeFileSync(part, data);
    renameSync(part, path);
  } catch (e) {
    try {
      rmSync(part, { force: true });
    } catch {
      /* nothing to clean up */
    }
    throw e;
  }
}
