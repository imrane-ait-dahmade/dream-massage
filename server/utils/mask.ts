/** Return the first 4 chars of a device ID followed by ***, or null if not set. */
export function maskDeviceId(raw: string | undefined | null): string | null {
  if (!raw) return null;
  if (raw.length <= 4) return '***';
  return `${raw.slice(0, 4)}***`;
}
