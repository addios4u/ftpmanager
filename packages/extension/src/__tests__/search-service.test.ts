import { describe, it, expect, vi } from 'vitest';
import { searchByName, searchByContent } from '../services/search-service.js';
import type { IFtpClient } from '../services/ftp-client.js';
import type { RemoteFileEntry } from '@ftpmanager/shared';

function makeEntry(name: string, type: 'file' | 'directory' | 'symlink' = 'file'): RemoteFileEntry {
  return { name, type, size: 0, modifiedAt: new Date(0) };
}

function makeMockClient(overrides: Partial<IFtpClient> = {}): IFtpClient {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    list: vi.fn(async () => []),
    downloadFile: vi.fn(),
    downloadFolder: vi.fn(),
    uploadFile: vi.fn(),
    uploadFolder: vi.fn(),
    mkdir: vi.fn(),
    delete: vi.fn(),
    rmdir: vi.fn(),
    rename: vi.fn(),
    getContent: vi.fn(async () => Buffer.from('')),
    putContent: vi.fn(),
    pwd: vi.fn(),
    ...overrides,
  } as unknown as IFtpClient;
}

// ---------------------------------------------------------------------------
// searchByName
// ---------------------------------------------------------------------------
describe('searchByName', () => {
  it('returns empty array for empty directory', async () => {
    const client = makeMockClient({ list: vi.fn(async () => []) });
    const results = await searchByName(client, 'c1', '/', 'test');
    expect(results).toEqual([]);
  });

  it('returns matching files in root directory', async () => {
    const client = makeMockClient({
      list: vi.fn(async () => [
        makeEntry('readme.txt'),
        makeEntry('notes.md'),
        makeEntry('image.png'),
      ]),
    });
    const results = await searchByName(client, 'c1', '/', 'readme');
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('readme.txt');
    expect(results[0].remotePath).toBe('/readme.txt');
    expect(results[0].connectionId).toBe('c1');
    expect(results[0].matchType).toBe('name');
  });

  it('recursively searches subdirectories', async () => {
    const listMock = vi.fn(async (dirPath: string) => {
      if (dirPath === '/') {
        return [makeEntry('subdir', 'directory'), makeEntry('root.txt')];
      }
      if (dirPath === '/subdir') {
        return [makeEntry('deep-file.txt')];
      }
      return [];
    });
    const client = makeMockClient({ list: listMock });
    const results = await searchByName(client, 'c1', '/', 'deep');
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('deep-file.txt');
    expect(results[0].remotePath).toBe('/subdir/deep-file.txt');
  });

  it('does not recurse beyond maxDepth', async () => {
    // depth 0: root has subdir
    // depth 1: subdir has nested
    // depth 2: nested has target — should NOT be visited when maxDepth=1
    const listMock = vi.fn(async (dirPath: string) => {
      if (dirPath === '/') return [makeEntry('subdir', 'directory')];
      if (dirPath === '/subdir') return [makeEntry('nested', 'directory')];
      if (dirPath === '/subdir/nested') return [makeEntry('target.txt')];
      return [];
    });
    const client = makeMockClient({ list: listMock });
    const results = await searchByName(client, 'c1', '/', 'target', { maxDepth: 1 });
    expect(results).toHaveLength(0);
    // subdir/nested should never have been listed
    expect(listMock).not.toHaveBeenCalledWith('/subdir/nested');
  });

  it('is case-insensitive', async () => {
    const client = makeMockClient({
      list: vi.fn(async () => [makeEntry('MyDocument.pdf')]),
    });
    const results = await searchByName(client, 'c1', '/', 'mydocument');
    expect(results).toHaveLength(1);
    expect(results[0].fileName).toBe('MyDocument.pdf');
  });

  it('calls onProgress for each directory visited', async () => {
    const listMock = vi.fn(async (dirPath: string) => {
      if (dirPath === '/') return [makeEntry('sub', 'directory')];
      if (dirPath === '/sub') return [makeEntry('file.txt')];
      return [];
    });
    const client = makeMockClient({ list: listMock });
    const onProgress = vi.fn();
    await searchByName(client, 'c1', '/', 'file', {}, onProgress);
    expect(onProgress).toHaveBeenCalledWith('/');
    expect(onProgress).toHaveBeenCalledWith('/sub');
    expect(onProgress).toHaveBeenCalledTimes(2);
  });

  it('returns empty array immediately when AbortSignal is already aborted', async () => {
    const listMock = vi.fn(async () => [makeEntry('match.txt')]);
    const client = makeMockClient({ list: listMock });
    const controller = new AbortController();
    controller.abort();
    const results = await searchByName(client, 'c1', '/', 'match', { signal: controller.signal });
    expect(results).toEqual([]);
    expect(listMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// searchByContent
// ---------------------------------------------------------------------------
describe('searchByContent', () => {
  const baseFile = {
    connectionId: 'c1',
    remotePath: '/file.txt',
    fileName: 'file.txt',
    matchType: 'name' as const,
  };

  it('returns empty array when no lines match', async () => {
    const client = makeMockClient({
      getContent: vi.fn(async () => Buffer.from('hello world\nfoo bar\n')),
    });
    const results = await searchByContent(client, 'c1', [baseFile], 'zzz');
    expect(results).toEqual([]);
  });

  it('returns lineNumber and lineContent for matching lines', async () => {
    const client = makeMockClient({
      getContent: vi.fn(async () => Buffer.from('first line\nsecond match line\nthird line')),
    });
    const results = await searchByContent(client, 'c1', [baseFile], 'match');
    expect(results).toHaveLength(1);
    expect(results[0].lineNumber).toBe(2);
    expect(results[0].lineContent).toBe('second match line');
    expect(results[0].matchType).toBe('content');
    expect(results[0].fileName).toBe('file.txt');
    expect(results[0].remotePath).toBe('/file.txt');
  });

  it('is case-insensitive for content search', async () => {
    const client = makeMockClient({
      getContent: vi.fn(async () => Buffer.from('Line With KEYWORD here\nnormal line')),
    });
    const results = await searchByContent(client, 'c1', [baseFile], 'keyword');
    expect(results).toHaveLength(1);
    expect(results[0].lineNumber).toBe(1);
  });

  it('trims lineContent to 100 characters', async () => {
    const longLine = 'a'.repeat(50) + 'MATCH' + 'b'.repeat(200);
    const client = makeMockClient({
      getContent: vi.fn(async () => Buffer.from(longLine)),
    });
    const results = await searchByContent(client, 'c1', [baseFile], 'MATCH');
    expect(results).toHaveLength(1);
    expect(results[0].lineContent!.length).toBe(100);
  });

  it('skips files beyond the 50-file limit', async () => {
    const getContentMock = vi.fn(async () => Buffer.from('keyword found'));
    const client = makeMockClient({ getContent: getContentMock });

    // Build 60 file entries
    const files = Array.from({ length: 60 }, (_, i) => ({
      connectionId: 'c1',
      remotePath: `/file${i}.txt`,
      fileName: `file${i}.txt`,
      matchType: 'name' as const,
    }));

    const results = await searchByContent(client, 'c1', files, 'keyword');
    // Only 50 files processed
    expect(getContentMock).toHaveBeenCalledTimes(50);
    // Each file has one match
    expect(results).toHaveLength(50);
  });

  it('returns empty array immediately when AbortSignal is already aborted', async () => {
    const getContentMock = vi.fn(async () => Buffer.from('keyword line'));
    const client = makeMockClient({ getContent: getContentMock });
    const controller = new AbortController();
    controller.abort();
    const results = await searchByContent(client, 'c1', [baseFile], 'keyword', controller.signal);
    expect(results).toEqual([]);
    expect(getContentMock).not.toHaveBeenCalled();
  });
});
