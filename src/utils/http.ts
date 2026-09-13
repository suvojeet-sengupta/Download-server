import type { Request } from 'express';
import { config } from '../config/env';

/**
 * Base URL used to build shareable links. PUBLIC_URL wins so links stay correct
 * behind a reverse proxy or tunnel; otherwise fall back to the request host.
 */
export function resolveBaseUrl(req: Request): string {
  if (config.publicUrl) return config.publicUrl;
  return `${req.protocol}://${req.get('host') ?? `localhost:${config.port}`}`;
}

export function downloadUrlFor(baseUrl: string, id: string, name?: string): string {
  if (!name) return `${baseUrl}/d/${id}`;
  return `${baseUrl}/d/${id}/${encodeURIComponent(name)}`;
}

/** Minimal HTML error body, matching the previous plain-text pages. */
export function errorPage(title: string, detail: string): string {
  return `<h1>${title}</h1><p>${detail}</p>`;
}
