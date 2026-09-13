import type { StoredItem } from '../types/domain';

export type Category = 'folder' | 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

/**
 * Extension fallback. This carries real weight: uploads recovered from disk by
 * the startup re-index have no stored MIME type, so without these entries a
 * video would show up as a generic file.
 */
const EXTENSION_MAP: Record<string, Category> = {
  // documents
  pdf: 'document', doc: 'document', docx: 'document', odt: 'document', rtf: 'document',
  txt: 'document', md: 'document', csv: 'document', xls: 'document', xlsx: 'document',
  ppt: 'document', pptx: 'document', json: 'document', xml: 'document', log: 'document',
  // archives
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  bz2: 'archive', xz: 'archive', tgz: 'archive',
  // images
  jpg: 'image', jpeg: 'image', png: 'image', gif: 'image', webp: 'image', svg: 'image',
  avif: 'image', bmp: 'image', heic: 'image', tif: 'image', tiff: 'image', ico: 'image',
  // video
  mp4: 'video', mkv: 'video', mov: 'video', webm: 'video', avi: 'video', m4v: 'video',
  wmv: 'video', flv: 'video', mpg: 'video', mpeg: 'video', '3gp': 'video',
  // audio
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio',
  opus: 'audio', wma: 'audio', aiff: 'audio',
};

/**
 * Groups an item for the sidebar filters and icon choice. MIME type is trusted
 * first; the extension is the fallback because re-indexed uploads recovered
 * from disk carry a generic octet-stream type.
 */
/** Classifies any file by declared type first, then by extension. */
export function categoryOfFile(name: string, mimeType: string): Category {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime === 'application/pdf' || mime.startsWith('text/')) return 'document';
  if (mime.includes('zip') || mime.includes('compressed') || mime.includes('tar')) return 'archive';

  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
  return EXTENSION_MAP[ext] ?? 'other';
}

export function categoryOf(item: StoredItem): Category {
  if (item.type === 'folder') return 'folder';
  return categoryOfFile(item.name, item.mimeType);
}

/** Best-effort content type for inline preview of a re-indexed upload. */
const INLINE_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', flac: 'audio/flac', m4a: 'audio/mp4',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/plain', json: 'application/json',
  csv: 'text/csv', log: 'text/plain',
};

export function inlineContentType(name: string, declared: string): string {
  if (declared && declared !== 'application/octet-stream') return declared;
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() ?? '' : '';
  return INLINE_TYPES[ext] ?? 'application/octet-stream';
}
