const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** Human readable byte size. Matches the previous implementation's output. */
export function formatBytes(bytes: number, decimals = 2): string {
  if (!Number.isFinite(bytes) || bytes === 0) return '0 B';
  const dm = decimals < 0 ? 0 : decimals;
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const value = bytes / Math.pow(1024, index);
  return `${Number.parseFloat(value.toFixed(dm))} ${UNITS[index]}`;
}
