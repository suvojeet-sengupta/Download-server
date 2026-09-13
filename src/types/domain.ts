/**
 * Domain model for the on-disk index (data/db.json).
 *
 * The shapes here are the shapes the previous JavaScript implementation wrote,
 * so existing databases and share links keep working without a migration.
 */

/** A single uploaded file, addressable at /d/:id */
export interface StoredFile {
  id: string;
  name: string;
  type: 'file';
  size: number;
  mimeType: string;
  uploadedAt: string;
  downloads: number;
}

/** One member of a folder upload. Has no id of its own. */
export interface FolderChild {
  name: string;
  relativePath: string;
  size: number;
  mimeType: string;
}

/** A folder upload, addressable at /d/:id and downloadable as a ZIP */
export interface StoredFolder {
  id: string;
  name: string;
  type: 'folder';
  size: number;
  uploadedAt: string;
  downloads: number;
  files: FolderChild[];
}

/** Discriminated on `type`, so narrowing drives the download behaviour. */
export type StoredItem = StoredFile | StoredFolder;

export interface ShortLink {
  id: string;
  longUrl: string;
  clicks: number;
  createdAt: string;
}

export interface Database {
  files: StoredItem[];
  links: ShortLink[];
}

/** Sidecar written to uploads/temp/<uploadId>/meta.json during chunked uploads. */
export interface UploadMeta {
  uploadId: string;
  name: string;
  size: number;
  mimeType: string;
  chunkSize: number;
  totalChunks: number;
  fingerprint: string;
  folderId?: string;
  relativePath?: string;
  createdAt: string;
}

export type ZipTask =
  | { status: 'zipping'; progress: number; total: number }
  | { status: 'done'; progress: number; total: number; url: string }
  | { status: 'error'; error: string };

/** Shape returned to the UI: a record plus its resolved public links. */
export type ItemWithLinks<T> = T & { downloadUrl: string; directUrl: string };

export function isFolder(item: StoredItem): item is StoredFolder {
  return item.type === 'folder';
}
