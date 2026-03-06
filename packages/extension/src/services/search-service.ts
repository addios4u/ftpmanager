import type { IFtpClient } from './ftp-client.js';

export interface SearchResult {
  connectionId: string;
  remotePath: string;
  fileName: string;
  matchType: 'name' | 'content';
  lineNumber?: number;
  lineContent?: string;
}

export interface SearchOptions {
  maxDepth?: number;
  signal?: AbortSignal;
}

/**
 * Recursively search remote files by filename keyword (case-insensitive).
 * maxDepth default: 5. Respects AbortSignal.
 */
export async function searchByName(
  client: IFtpClient,
  connectionId: string,
  rootPath: string,
  keyword: string,
  options: SearchOptions = {},
  onProgress?: (path: string) => void,
): Promise<SearchResult[]> {
  const maxDepth = options.maxDepth ?? 5;
  const signal = options.signal;
  const results: SearchResult[] = [];
  const lowerKeyword = keyword.toLowerCase();

  // BFS queue: [dirPath, depth]
  const queue: Array<[string, number]> = [[rootPath, 0]];

  while (queue.length > 0) {
    if (signal?.aborted) {
      return results;
    }

    const [dirPath, depth] = queue.shift()!;

    if (depth > maxDepth) {
      continue;
    }

    onProgress?.(dirPath);

    let entries;
    try {
      entries = await client.list(dirPath);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (signal?.aborted) {
        return results;
      }

      const entryPath =
        dirPath === '/' ? `/${entry.name}` : `${dirPath}/${entry.name}`;

      if (entry.name.toLowerCase().includes(lowerKeyword)) {
        results.push({
          connectionId,
          remotePath: entryPath,
          fileName: entry.name,
          matchType: 'name',
        });
      }

      if (entry.type === 'directory') {
        if (depth + 1 <= maxDepth) {
          queue.push([entryPath, depth + 1]);
        }
      }
    }
  }

  return results;
}

/**
 * Search file contents for keyword (case-insensitive).
 * Downloads each file from files[] and searches line by line.
 * Max 50 files. Returns results with lineNumber + lineContent (trimmed to 100 chars).
 * Respects AbortSignal.
 */
export async function searchByContent(
  client: IFtpClient,
  connectionId: string,
  files: SearchResult[],
  keyword: string,
  signal?: AbortSignal,
  onProgress?: (path: string) => void,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const lowerKeyword = keyword.toLowerCase();
  const limit = Math.min(files.length, 50);

  for (let i = 0; i < limit; i++) {
    if (signal?.aborted) {
      return results;
    }

    const file = files[i];
    onProgress?.(file.remotePath);

    let content: Buffer;
    try {
      content = await client.getContent(file.remotePath);
    } catch {
      continue;
    }

    const lines = content.toString('utf-8').split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      if (signal?.aborted) {
        return results;
      }

      const line = lines[lineIdx];
      if (line.toLowerCase().includes(lowerKeyword)) {
        results.push({
          connectionId,
          remotePath: file.remotePath,
          fileName: file.fileName,
          matchType: 'content',
          lineNumber: lineIdx + 1,
          lineContent: line.trim().slice(0, 100),
        });
      }
    }
  }

  return results;
}
