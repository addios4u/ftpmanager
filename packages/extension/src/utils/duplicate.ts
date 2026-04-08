import * as path from 'path';

/**
 * Returns a unique copy name for a remote file or directory.
 *
 * Examples:
 *   "report.txt"   → "report_copy.txt"   → "report_copy_2.txt" ...
 *   "images"       → "images_copy"        → "images_copy_2" ...
 *   "archive.tar.gz" → "archive.tar_copy.gz"
 */
export function getUniqueCopyName(originalName: string, existingNames: string[]): string {
  const existing = new Set(existingNames);
  const ext = path.extname(originalName);
  const base = ext ? originalName.slice(0, -ext.length) : originalName;

  const first = `${base}_copy${ext}`;
  if (!existing.has(first)) return first;

  let n = 2;
  while (true) {
    const candidate = `${base}_copy_${n}${ext}`;
    if (!existing.has(candidate)) return candidate;
    n++;
  }
}
