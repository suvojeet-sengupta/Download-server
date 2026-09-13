import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { UPLOADS_DIR } from '../config/paths';
import { readDatabase } from '../db/database';
import { isFolder } from '../types/domain';
import { inlineContentType } from '../utils/category';
import { resolveWithin, wildcardPath } from '../utils/paths';

export const previewRouter = Router();

/**
 * Inline sibling of /d/:id. Same resolution rules, but served with an inline
 * disposition so the browser renders images, video, audio, PDFs and text in
 * place instead of downloading them. Deliberately public, exactly like the
 * download link it mirrors, and it never increments the download counter.
 */
function handlePreview(req: Request, res: Response): void {
  const { id } = req.params as { id: string };
  const requested = decodeURIComponent(wildcardPath(req));

  const item = readDatabase().files.find((f) => f.id === id);
  if (!item) {
    res.status(404).send('Not found');
    return;
  }

  let filePath: string | null;
  let name: string;
  let declaredType: string;

  if (isFolder(item)) {
    const child = item.files.find((f) => f.name === requested || f.relativePath === requested);
    if (!child) {
      res.status(404).send('Not found');
      return;
    }
    filePath = resolveWithin(path.join(UPLOADS_DIR, id), child.relativePath);
    name = child.name;
    declaredType = child.mimeType;
  } else {
    filePath = resolveWithin(path.join(UPLOADS_DIR, id), item.name);
    name = item.name;
    declaredType = item.mimeType;
  }

  if (!filePath || !fs.existsSync(filePath)) {
    res.status(404).send('Not found');
    return;
  }

  res.setHeader('Content-Type', inlineContentType(name, declaredType));
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
  // Immutable: a share id always points at the same bytes.
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(filePath);
}

previewRouter.get('/p/:id', handlePreview);
previewRouter.get('/p/:id/*splat', handlePreview);
