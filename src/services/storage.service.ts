import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/env';
import { UPLOADS_DIR } from '../config/paths';
import { totalStorageUsed } from '../db/database';

export interface CapacityVerdict {
  allowed: boolean;
  message?: string;
}

/** Rejects an incoming upload that would push total usage past the ceiling. */
export function checkCapacity(incomingBytes: number): CapacityVerdict {
  const incoming = Number.isFinite(incomingBytes) ? incomingBytes : 0;
  if (totalStorageUsed() + incoming <= config.maxStorageBytes) return { allowed: true };
  return {
    allowed: false,
    message: `Storage capacity full: ${config.maxStorageGb} GB limit reached.`,
  };
}

export function itemDir(id: string): string {
  return path.join(UPLOADS_DIR, id);
}

export function zipPath(id: string): string {
  return path.join(UPLOADS_DIR, `${id}.zip`);
}

/** Removes an upload directory and any cached ZIP. Never throws. */
export function removeItemFromDisk(id: string): void {
  for (const target of [itemDir(id), zipPath(id)]) {
    if (!fs.existsSync(target)) continue;
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (error) {
      console.error(`Failed to delete ${target}:`, error);
    }
  }
}

export function discardTempFile(filePath: string | undefined): void {
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {
    /* best effort */
  }
}
