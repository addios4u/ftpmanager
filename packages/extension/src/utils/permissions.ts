import * as path from 'path';
import type { IFtpClient } from '../services/ftp-client.js';

/**
 * 원격 폴더를 재귀 탐색하여 { 상대경로 → permissions } 맵 생성.
 *
 * e.g. Map {
 *   ""               → "755",  ← 폴더 자체
 *   "index.php"      → "644",
 *   "sub"            → "755",
 *   "sub/secret.txt" → "600",
 * }
 */
export async function collectPermissions(
  client: IFtpClient,
  remotePath: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();

  // 루트 폴더 자체의 퍼미션 수집
  const parentDir = path.posix.dirname(remotePath);
  const folderName = path.posix.basename(remotePath);
  try {
    const parentEntries = await client.list(parentDir);
    const rootEntry = parentEntries.find((e) => e.name === folderName);
    if (rootEntry?.permissions) {
      map.set('', rootEntry.permissions);
    }
  } catch {
    // 부모 목록 조회 실패 시 루트 퍼미션 건너뜀
  }

  await walk(client, remotePath, remotePath, map);
  return map;
}

async function walk(
  client: IFtpClient,
  basePath: string,
  currentPath: string,
  map: Map<string, string>,
): Promise<void> {
  const entries = await client.list(currentPath);
  for (const entry of entries) {
    // path.posix.join으로 이중 슬래시 방지 (루트 '/' 처리 포함)
    const entryRemote = path.posix.join(currentPath, entry.name);
    const relPath = entryRemote.slice(basePath.length + 1);
    if (entry.permissions) {
      map.set(relPath, entry.permissions);
    }
    if (entry.type === 'directory') {
      await walk(client, basePath, entryRemote, map);
    }
  }
}
