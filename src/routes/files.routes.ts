import { Router } from 'express';
import { config } from '../config/env';
import { readDatabase, writeDatabase } from '../db/database';
import { authenticate } from '../middleware/authenticate';
import { removeItemFromDisk } from '../services/storage.service';
import { isFolder } from '../types/domain';
import { downloadUrlFor, resolveBaseUrl } from '../utils/http';

export const filesRouter = Router();

/** Management listing, newest first, with resolved public links. */
filesRouter.get('/api/files', authenticate, (req, res) => {
  const db = readDatabase();
  const baseUrl = resolveBaseUrl(req);

  const files = [...db.files]
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .map((item) => ({
      ...item,
      downloadUrl: isFolder(item)
        ? downloadUrlFor(baseUrl, item.id)
        : downloadUrlFor(baseUrl, item.id, item.name),
      directUrl: downloadUrlFor(baseUrl, item.id),
    }));

  res.json({ files, maxStorage: config.maxStorageBytes });
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
