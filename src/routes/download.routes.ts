import fs from 'node:fs';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { UPLOADS_DIR } from '../config/paths';
import { readDatabase, writeDatabase } from '../db/database';
import { isFolder } from '../types/domain';
import { errorPage, resolveBaseUrl } from '../utils/http';
import { renderFolderPage } from '../views/folder-page';

export const downloadRouter = Router();

/**
 * Express 5 uses path-to-regexp v8, where a bare "*" is no longer a valid
 * pattern. The trailing segment is captured as a named wildcard instead, which
 * arrives as an array of path segments.
 */
function wildcardPath(req: Request): string {
  const splat = (req.params as Record<string, string | string[] | undefined>).splat;
  if (Array.isArray(splat)) return splat.join('/');
  return splat ?? '';
}

/** Blocks path traversal: the resolved target must stay inside its own share. */
function resolveWithin(baseDir: string, relativePath: string): string | null {
  const resolved = path.resolve(baseDir, relativePath);
  const root = path.resolve(baseDir);
  return resolved === root || resolved.startsWith(`${root}${path.sep}`) ? resolved : null;
}

function handleDownload(req: Request, res: Response): void {
  const { id } = req.params as { id: string };
  const requested = decodeURIComponent(wildcardPath(req));

  const db = readDatabase();
  const index = db.files.findIndex((item) => item.id === id);

  if (index === -1) {
    res.status(404).send(errorPage('404 - Not Found', 'The file or folder does not exist.'));
    return;
  }

  const item = db.files[index];
  if (!item) {
    res.status(404).send(errorPage('404 - Not Found', 'The file or folder does not exist.'));
    return;
  }

  if (isFolder(item)) {
    // A specific member was requested: serve it directly.
    if (requested && requested !== item.name) {
      const child = item.files.find(
        (f) => f.name === requested || f.relativePath === requested,
      );
      if (!child) {
        res.status(404).send('File not found in folder.');
        return;
      }

      const filePath = resolveWithin(path.join(UPLOADS_DIR, id), child.relativePath);
      if (!filePath || !fs.existsSync(filePath)) {
        res.status(404).send('File missing.');
        return;
      }

      res.download(filePath, child.name);
      return;
    }

    res.type('html').send(renderFolderPage(item, resolveBaseUrl(req)));
    return;
  }

  const filePath = resolveWithin(path.join(UPLOADS_DIR, id), item.name);
  if (!filePath || !fs.existsSync(filePath)) {
    res
      .status(404)
      .send(errorPage('404 - File Not Found', 'The file is missing from the server filesystem.'));
    return;
  }

  item.downloads += 1;
  writeDatabase(db);

  res.download(filePath, item.name, (error) => {
    if (error && !res.headersSent) res.status(500).send('Error sending file');
  });
}

downloadRouter.get('/d/:id', handleDownload);
downloadRouter.get('/d/:id/*splat', handleDownload);
