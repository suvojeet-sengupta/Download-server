import crypto from 'node:crypto';

const BASE62 = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Public share id. 4 bytes -> 8 hex chars, matching existing links. */
export function newItemId(): string {
  return crypto.randomBytes(4).toString('hex');
}

/** Chunked-upload session id. 8 bytes -> 16 hex chars. */
export function newUploadId(): string {
  return crypto.randomBytes(8).toString('hex');
}

/** Opaque name for a multer temp file. */
export function newTempName(): string {
  return crypto.randomBytes(16).toString('hex');
}

/** Cryptographically random base62, used for short-link suffixes. */
export function randomBase62(length: number): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += BASE62.charAt((bytes[i] as number) % BASE62.length);
  }
  return out;
}
