import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { config } from '../config/env';
import { readDatabase, writeDatabase } from '../db/database';
import { authenticate } from '../middleware/authenticate';
import { itemDir, removeItemFromDisk, sanitizeFileName } from '../services/storage.service';
import { categoryOf } from '../utils/category';
import { isFolder } from '../types/domain';
import { resolveBaseUrl } from '../utils/http';
import { withLinks } from '../utils/serialize';

export const filesRouter = Router();

/** Management listing, newest first, with resolved public links. */
filesRouter.get('/api/files', authenticate, (req, res) => {
  const db = readDatabase();
  const baseUrl = resolveBaseUrl(req);

  const files = [...db.files]
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .map((item) => withLinks(item, baseUrl));

  res.json({ files, maxStorage: config.maxStorageBytes });
});

/** Aggregate counters for the sidebar: usage bar and per-category totals. */
filesRouter.get('/api/stats', authenticate, (_req, res) => {
  const { files } = readDatabase();

  const byCategory: Record<string, { count: number; size: number }> = {};
  let used = 0;
  let folders = 0;

  for (const item of files) {
    used += item.size || 0;
    if (isFolder(item)) folders += 1;

    const key = categoryOf(item);
    const bucket = byCategory[key] ?? { count: 0, size: 0 };
    bucket.count += 1;
    bucket.size += item.size || 0;
    byCategory[key] = bucket;
  }

  res.json({
    used,
    total: config.maxStorageBytes,
    items: files.length,
    folders,
    files: files.length - folders,
    byCategory,
  });
});

/** Rename an item. Files are renamed on disk too so the share link keeps working. */
filesRouter.patch('/api/files/:id', authenticate, (req, res) => {
  const { id } = req.params as { id: string };
  const { name } = req.body as { name?: string };

  if (typeof name !== 'string') {
    res.status(400).json({ error: 'A new name is required' });
    return;
  }

  const clean = sanitizeFileName(name);
  if (!clean) {
    res.status(400).json({ error: 'That name is not valid' });
    return;
  }

  const db = readDatabase();
  const item = db.files.find((f) => f.id === id);
  if (!item) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  // A folder's name is display-only: its members live under the share id, so
  // nothing on disk has to move.
  if (!isFolder(item) && clean !== item.name) {
    const from = path.join(itemDir(id), item.name);
    const to = path.join(itemDir(id), clean);
    try {
      if (fs.existsSync(from)) fs.renameSync(from, to);
    } catch (error) {
      console.error('Rename failed on disk:', error);
      res.status(500).json({ error: 'Could not rename the file on disk' });
      return;
    }
  }

  item.name = clean;
  writeDatabase(db);

  res.json({ success: true, file: withLinks(item, resolveBaseUrl(req)) });
});

/** Bulk delete, so the UI can act on a multi-selection in one request. */
filesRouter.post('/api/files/delete', authenticate, (req, res) => {
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: 'Provide an array of ids' });
    return;
  }

  const wanted = new Set(ids.filter((id): id is string => typeof id === 'string'));
  const db = readDatabase();
  const removed: string[] = [];

  db.files = db.files.filter((item) => {
    if (!wanted.has(item.id)) return true;
    removeItemFromDisk(item.id);
    removed.push(item.id);
    return false;
  });

  writeDatabase(db);
  res.json({ success: true, removed, count: removed.length });
});

filesRouter.delete('/api/files/:id', authenticate, (req, res) => {
  const { id } = req.params as { id: string };
  const db = readDatabase();
  const index = db.files.findIndex((item) => item.id === id);

  if (index === -1) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  removeItemFromDisk(id);
  db.files.splice(index, 1);
  writeDatabase(db);

  res.json({ success: true });
});
