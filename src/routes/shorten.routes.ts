import { Router } from 'express';
import { readDatabase, writeDatabase } from '../db/database';
import { authenticate } from '../middleware/authenticate';
import {
  SHORT_PREFIX,
  codeExists,
  generateCode,
  normalizeLongUrl,
} from '../services/shortlink.service';
import type { ShortLink } from '../types/domain';
import { resolveBaseUrl } from '../utils/http';

export const shortenRouter = Router();

shortenRouter.post('/api/shorten', authenticate, (req, res) => {
  const { url, customAlias } = req.body as { url?: string; customAlias?: string };
  if (!url) {
    res.status(400).json({ error: 'URL parameter is required' });
    return;
  }

  const db = readDatabase();
  const alias = customAlias?.trim() ?? '';
  let code: string;

  if (alias) {
    if (!alias.startsWith(SHORT_PREFIX)) {
      res.status(400).json({ error: `Custom alias must start with "${SHORT_PREFIX}"` });
      return;
    }
    if (codeExists(db, alias)) {
      res.status(400).json({ error: 'This custom short link alias already exists.' });
      return;
    }
    code = alias;
  } else {
    const generated = generateCode(db);
    if (!generated) {
      res.status(500).json({ error: 'Failed to generate a unique short link alias.' });
      return;
    }
    code = generated;
  }

  const link: ShortLink = {
    id: code,
    longUrl: normalizeLongUrl(url),
    clicks: 0,
    createdAt: new Date().toISOString(),
  };

  db.links.push(link);
  writeDatabase(db);

  res.json({ success: true, link: { ...link, shortUrl: `${resolveBaseUrl(req)}/${code}` } });
});

shortenRouter.get('/api/shorten', authenticate, (req, res) => {
  const baseUrl = resolveBaseUrl(req);
  const links = readDatabase().links.map((link) => ({
    ...link,
    shortUrl: `${baseUrl}/${link.id}`,
  }));
  res.json({ links });
});

shortenRouter.delete('/api/shorten/:code', authenticate, (req, res) => {
  const db = readDatabase();
  const index = db.links.findIndex((link) => link.id === req.params.code);

  if (index === -1) {
    res.status(404).json({ error: 'Shortened link not found' });
    return;
  }

  db.links.splice(index, 1);
  writeDatabase(db);
  res.json({ success: true });
});
