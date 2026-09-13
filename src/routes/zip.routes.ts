import { Router } from 'express';
import { findItem, readDatabase } from '../db/database';
import { zipPath } from '../services/storage.service';
import { downloadPath, getTask, isZipping, startZip, zipExists } from '../services/zip.service';

export const zipRouter = Router();

/**
 * Folder ZIP lifecycle. Unauthenticated like the share links it serves: anyone
 * holding the folder id can already list and download its members.
 */
zipRouter.post('/api/zip/start/:id', (req, res) => {
  const { id } = req.params;
  const item = findItem(readDatabase(), id);

  if (!item) {
    res.status(404).send('Not found');
    return;
  }
  if (isZipping(id)) {
    res.json({ success: true, status: 'zipping' });
    return;
  }
  if (zipExists(id)) {
    res.json({ success: true, status: 'done', url: downloadPath(id) });
    return;
  }

  startZip(item);
  res.json({ success: true, status: 'zipping' });
});

zipRouter.get('/api/zip/status/:id', (req, res) => {
  const { id } = req.params;
  const task = getTask(id);

  if (task) {
    res.json(task);
    return;
  }
  // No in-memory task: a finished archive on disk still counts as done, which
  // is what keeps polling correct across a restart.
  if (zipExists(id)) {
    res.json({ status: 'done', progress: 100, total: 100, url: downloadPath(id) });
    return;
  }
  res.json({ status: 'not_started' });
});

zipRouter.get('/api/zip/download/:id', (req, res) => {
  const { id } = req.params;
  if (!zipExists(id)) {
    res.status(404).send('Zip not found');
    return;
  }

  const item = findItem(readDatabase(), id);
  res.download(zipPath(id), `${item?.name ?? id}.zip`);
});
