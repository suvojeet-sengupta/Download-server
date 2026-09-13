import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { UPLOADS_DIR } from '../config/paths';
import { readDatabase, writeDatabase } from '../db/database';
import { authenticate } from '../middleware/authenticate';
import { checkCapacity, discardTempFile, itemDir } from '../services/storage.service';
import { notifyFileUploaded, notifyFolderCreated } from '../services/telegram.service';
import {
  cleanupSession,
  chunkPath,
  findSessionByFingerprint,
  hasAllChunks,
  mergeChunks,
  nextMissingChunk,
  readMeta,
  resolveFinalPath,
  sessionDir,
  upload,
  writeMeta,
} from '../services/upload.service';
import type { FolderChild, StoredFile, StoredFolder, UploadMeta } from '../types/domain';
import { isFolder } from '../types/domain';
import { downloadUrlFor, resolveBaseUrl } from '../utils/http';
import { newItemId, newUploadId } from '../utils/ids';

export const uploadRouter = Router();

/** Single-request upload for small files. */
uploadRouter.post('/api/upload', authenticate, upload.single('file'), (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }

  const verdict = checkCapacity(req.file.size);
  if (!verdict.allowed) {
    discardTempFile(req.file.path);
    res.status(400).json({ error: verdict.message });
    return;
  }

  const id = newItemId();
  const target = path.join(itemDir(id), req.file.originalname);
  fs.mkdirSync(itemDir(id), { recursive: true });

  try {
    fs.renameSync(req.file.path, target);
  } catch (error) {
    console.error('Failed to move uploaded file:', error);
    discardTempFile(req.file.path);
    res.status(500).json({ error: 'Failed to process file on server' });
    return;
  }

  const record: StoredFile = {
    id,
    name: req.file.originalname,
    type: 'file',
    size: req.file.size,
    mimeType: req.file.mimetype,
    uploadedAt: new Date().toISOString(),
    downloads: 0,
  };

  const db = readDatabase();
  db.files.push(record);
  writeDatabase(db);

  const baseUrl = resolveBaseUrl(req);
  const downloadUrl = downloadUrlFor(baseUrl, record.id, record.name);
  const directUrl = downloadUrlFor(baseUrl, record.id);

  notifyFileUploaded({
    name: record.name,
    size: record.size,
    mimeType: record.mimeType,
    downloadUrl,
  });

  res.json({ success: true, file: { ...record, downloadUrl, directUrl } });
});

/** Registers an empty folder that chunked member uploads then populate. */
uploadRouter.post('/api/folder/create', authenticate, (req, res) => {
  const { name, size } = req.body as { name?: string; size?: number | string };
  if (!name) {
    res.status(400).json({ error: 'Folder name is required' });
    return;
  }

  const declaredSize = Number.parseInt(String(size ?? 0), 10) || 0;
  const verdict = checkCapacity(declaredSize);
  if (!verdict.allowed) {
    res.status(400).json({ error: verdict.message });
    return;
  }

  const record: StoredFolder = {
    id: newItemId(),
    name,
    type: 'folder',
    size: declaredSize,
    uploadedAt: new Date().toISOString(),
    downloads: 0,
    files: [],
  };

  const db = readDatabase();
  db.files.push(record);
  writeDatabase(db);
  fs.mkdirSync(itemDir(record.id), { recursive: true });

  const downloadUrl = downloadUrlFor(resolveBaseUrl(req), record.id);
  notifyFolderCreated({ name: record.name, size: record.size, downloadUrl });

  res.json({ success: true, folderId: record.id });
});

/** Opens a chunked session, or resumes one matching the same fingerprint. */
uploadRouter.post('/api/upload/init', authenticate, (req, res) => {
  const { name, size, mimeType, chunkSize, fingerprint, folderId, relativePath } =
    req.body as Partial<UploadMeta>;

  if (!name || size === undefined || !fingerprint) {
    res.status(400).json({ error: 'Missing upload metadata' });
    return;
  }

  const verdict = checkCapacity(Number(size));
  if (!verdict.allowed) {
    res.status(400).json({ error: verdict.message });
    return;
  }

  const existing = findSessionByFingerprint(fingerprint);
  if (existing) {
    res.json({
      success: true,
      uploadId: existing.uploadId,
      nextChunkIndex: nextMissingChunk(existing.uploadId),
      resumed: true,
    });
    return;
  }

  const uploadId = newUploadId();
  const effectiveChunkSize = Number(chunkSize) || Number(size) || 1;

  writeMeta({
    uploadId,
    name,
    size: Number(size),
    mimeType: mimeType ?? 'application/octet-stream',
    chunkSize: effectiveChunkSize,
    totalChunks: Math.ceil(Number(size) / effectiveChunkSize) || 1,
    fingerprint,
    folderId,
    relativePath,
    createdAt: new Date().toISOString(),
  });

  res.json({ success: true, uploadId, nextChunkIndex: 0, resumed: false });
});

/** Accepts one chunk; merges and registers the upload once the last one lands. */
uploadRouter.post(
  '/api/upload/chunk',
  authenticate,
  upload.single('chunk'),
  async (req, res) => {
    const { uploadId, chunkIndex } = req.body as { uploadId?: string; chunkIndex?: string };

    if (!req.file || !uploadId || chunkIndex === undefined) {
      discardTempFile(req.file?.path);
      res.status(400).json({ error: 'Missing chunk upload data' });
      return;
    }

    if (!fs.existsSync(sessionDir(uploadId))) {
      discardTempFile(req.file.path);
      res.status(404).json({ error: 'Upload session not found or expired' });
      return;
    }

    const index = Number.parseInt(String(chunkIndex), 10);
    try {
      fs.renameSync(req.file.path, chunkPath(uploadId, index));
    } catch (error) {
      console.error('Failed to save chunk:', error);
      discardTempFile(req.file.path);
      res.status(500).json({ error: 'Failed to save chunk on server' });
      return;
    }

    const meta = readMeta(uploadId);
    if (!meta) {
      res.status(500).json({ error: 'Upload metadata is missing' });
      return;
    }

    if (!hasAllChunks(uploadId, meta.totalChunks)) {
      res.json({ success: true, completed: false, nextChunkIndex: index + 1 });
      return;
    }

    const finalPath = resolveFinalPath(meta, uploadId);
    try {
      await mergeChunks(uploadId, meta, finalPath);
    } catch (error) {
      console.error('Merge write stream error:', error);
      res.status(500).json({ error: 'Failed to merge chunks on server' });
      return;
    }
    cleanupSession(uploadId);

    const baseUrl = resolveBaseUrl(req);
    const db = readDatabase();

    // Folder member: attach to the parent record, no separate share id or alert.
    if (meta.folderId && meta.relativePath) {
      const parent = db.files.find((item) => item.id === meta.folderId);
      const child: FolderChild = {
        name: meta.name,
        relativePath: meta.relativePath,
        size: meta.size,
        mimeType: meta.mimeType,
      };

      if (parent && isFolder(parent)) {
        parent.files.push(child);
        writeDatabase(db);
      }

      const downloadUrl = downloadUrlFor(baseUrl, meta.folderId);
      res.json({
        success: true,
        completed: true,
        file: { ...child, downloadUrl, directUrl: downloadUrl },
      });
      return;
    }

    const record: StoredFile = {
      id: uploadId,
      name: meta.name,
      type: 'file',
      size: meta.size,
      mimeType: meta.mimeType,
      uploadedAt: new Date().toISOString(),
      downloads: 0,
    };

    db.files.push(record);
    writeDatabase(db);

    const downloadUrl = downloadUrlFor(baseUrl, record.id, record.name);
    const directUrl = downloadUrlFor(baseUrl, record.id);

    notifyFileUploaded({
      name: record.name,
      size: record.size,
      mimeType: record.mimeType,
      downloadUrl,
    });

    res.json({ success: true, completed: true, file: { ...record, downloadUrl, directUrl } });
  },
);

/** Exposed for the download route, which resolves folder members by path. */
export function folderMemberPath(folderId: string, relativePath: string): string {
  return path.join(UPLOADS_DIR, folderId, relativePath);
}
