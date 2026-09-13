import path from 'node:path';
import type { Request } from 'express';

/**
 * Express 5 uses path-to-regexp v8, where a bare "*" is no longer a valid
 * pattern. The trailing segments are captured as a named wildcard and arrive
 * as an array.
 */
export function wildcardPath(req: Request): string {
  const splat = (req.params as Record<string, string | string[] | undefined>).splat;
  if (Array.isArray(splat)) return splat.join('/');
  return splat ?? '';
}

/** Blocks path traversal: the resolved target must stay inside its own share. */
export function resolveWithin(baseDir: string, relativePath: string): string | null {
  const resolved = path.resolve(baseDir, relativePath);
  const root = path.resolve(baseDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}
