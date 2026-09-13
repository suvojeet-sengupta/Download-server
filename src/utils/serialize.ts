import type { StoredItem } from '../types/domain';
import { isFolder } from '../types/domain';
import { categoryOf } from './category';
import { downloadUrlFor } from './http';

export interface SerializedItem {
  category: string;
  downloadUrl: string;
  directUrl: string;
  previewUrl: string | null;
}

/**
 * Single place that decorates a stored record with its public links and UI
 * category. Every endpoint that returns an item uses this, so the client never
 * has to special-case where the record came from.
 */
export function withLinks(item: StoredItem, baseUrl: string): StoredItem & SerializedItem {
  return {
    ...item,
    category: categoryOf(item),
    downloadUrl: isFolder(item)
      ? downloadUrlFor(baseUrl, item.id)
      : downloadUrlFor(baseUrl, item.id, item.name),
    directUrl: downloadUrlFor(baseUrl, item.id),
    previewUrl: isFolder(item) ? null : `${baseUrl}/p/${item.id}`,
  };
}
