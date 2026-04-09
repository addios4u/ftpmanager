import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FtpFileSystemProvider } from '../providers/ftp-fs-provider.js';
import type { IFtpClient } from '../services/ftp-client.js';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { RemoteFileEntry } from '@ftpmanager/shared';
import { FileType, FileChangeType } from 'vscode';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeUri(connectionId: string, remotePath: string) {
  return { authority: connectionId, path: remotePath } as unknown as import('vscode').Uri;
}

function makeEntry(overrides: Partial<RemoteFileEntry> = {}): RemoteFileEntry {
  return {
    name: 'index.php',
    type: 'file',
    size: 1024,
    modifiedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
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
    getContent: vi.fn(async () => Buffer.from('hello')),
    putContent: vi.fn(),
    pwd: vi.fn(),
    chmod: vi.fn(async () => {}),
    ...overrides,
  };
}

function makeMockManager(clients: Record<string, IFtpClient> = {}): ConnectionManager {
  return {
    getClient: vi.fn((id: string) => clients[id]),
  } as unknown as ConnectionManager;
}

// ─── suite ───────────────────────────────────────────────────────────────────

describe('FtpFileSystemProvider', () => {
  // ── parseUri ──────────────────────────────────────────────────────────────

  describe('parseUri', () => {
    it('extracts connectionId from URI authority', () => {
      const mgr = makeMockManager();
      const provider = new FtpFileSystemProvider(mgr);
      // access private via cast
      const parsed = (provider as unknown as { parseUri(u: unknown): { connectionId: string; remotePath: string } })
        .parseUri(makeUri('abc123', '/public_html/index.php'));
      expect(parsed.connectionId).toBe('abc123');
    });

    it('extracts remotePath from URI path', () => {
      const mgr = makeMockManager();
      const provider = new FtpFileSystemProvider(mgr);
      const parsed = (provider as unknown as { parseUri(u: unknown): { connectionId: string; remotePath: string } })
        .parseUri(makeUri('abc123', '/public_html/index.php'));
      expect(parsed.remotePath).toBe('/public_html/index.php');
    });

    it('defaults remotePath to "/" when path is empty', () => {
      const mgr = makeMockManager();
      const provider = new FtpFileSystemProvider(mgr);
      const parsed = (provider as unknown as { parseUri(u: unknown): { connectionId: string; remotePath: string } })
        .parseUri(makeUri('abc123', ''));
      expect(parsed.remotePath).toBe('/');
    });
  });

  // ── stat() ────────────────────────────────────────────────────────────────

  describe('stat()', () => {
    it('returns FileStat for an existing file', async () => {
      const entry = makeEntry({ name: 'index.php', type: 'file', size: 512 });
      const client = makeMockClient({ list: vi.fn(async () => [entry]) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      // uri: ftpmanager://conn1/public_html/index.php
      const uri = makeUri('conn1', '/public_html/index.php');
      const stat = await provider.stat(uri);

      expect(stat.type).toBe(FileType.File);
      expect(stat.size).toBe(512);
    });

    it('returns FileStat with correct mtime from modifiedAt', async () => {
      const modifiedAt = new Date('2024-06-15T12:00:00Z');
      const entry = makeEntry({ name: 'log.txt', modifiedAt });
      const client = makeMockClient({ list: vi.fn(async () => [entry]) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const stat = await provider.stat(makeUri('conn1', '/log.txt'));
      expect(stat.mtime).toBe(modifiedAt.getTime());
    });

    it('returns FileType.Directory for directory entries', async () => {
      const entry = makeEntry({ name: 'public', type: 'directory', size: 0 });
      const client = makeMockClient({ list: vi.fn(async () => [entry]) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const stat = await provider.stat(makeUri('conn1', '/public'));
      expect(stat.type).toBe(FileType.Directory);
    });

    it('throws FileNotFound when entry not in parent listing', async () => {
      const client = makeMockClient({ list: vi.fn(async () => [makeEntry({ name: 'other.txt' })]) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.stat(makeUri('conn1', '/missing.txt')))
        .rejects.toThrow(/FileNotFound/);
    });

    it('throws Unavailable when no client for connectionId', async () => {
      const mgr = makeMockManager({}); // no client registered
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.stat(makeUri('unknown-conn', '/file.txt')))
        .rejects.toThrow(/Unavailable/);
    });

    /**
     * BUG-001 Fix: stat() for root path '/' should return Directory FileStat.
     * Previously: path.posix.basename('/') === '' → no entry found → FileNotFound
     * Fixed: root path is now handled as a special case.
     */
    it('returns Directory FileStat for root path "/" (BUG-001 fixed)', async () => {
      const client = makeMockClient();
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const stat = await provider.stat(makeUri('conn1', '/'));
      expect(stat.type).toBe(FileType.Directory);
    });
  });

  // ── readFile() ────────────────────────────────────────────────────────────

  describe('readFile()', () => {
    it('returns Uint8Array of file content', async () => {
      const client = makeMockClient({ getContent: vi.fn(async () => Buffer.from('hello world')) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const result = await provider.readFile(makeUri('conn1', '/file.txt'));
      expect(result).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(result).toString()).toBe('hello world');
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.readFile(makeUri('unknown', '/file.txt')))
        .rejects.toThrow(/Unavailable/);
    });
  });

  // ── writeFile() ───────────────────────────────────────────────────────────

  describe('writeFile()', () => {
    it('calls putContent with correct args', async () => {
      const putContent = vi.fn();
      const client = makeMockClient({ putContent });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const content = new Uint8Array([72, 101, 108, 108, 111]); // 'Hello'
      await provider.writeFile(makeUri('conn1', '/upload.txt'), content, { create: true, overwrite: true });

      expect(putContent).toHaveBeenCalledWith(Buffer.from(content), '/upload.txt');
    });

    it('fires onDidChangeFile Changed event after write', async () => {
      const client = makeMockClient();
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const uri = makeUri('conn1', '/upload.txt');
      await provider.writeFile(uri, new Uint8Array([1, 2, 3]), { create: true, overwrite: true });

      expect(listener).toHaveBeenCalledOnce();
      const events = listener.mock.calls[0][0] as Array<{ type: number; uri: unknown }>;
      expect(events[0].type).toBe(FileChangeType.Changed);
      expect(events[0].uri).toBe(uri);
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(
        provider.writeFile(makeUri('unknown', '/file.txt'), new Uint8Array(), { create: true, overwrite: false }),
      ).rejects.toThrow(/Unavailable/);
    });
  });

  // ── createDirectory() ─────────────────────────────────────────────────────

  describe('createDirectory()', () => {
    it('calls client.mkdir with remotePath', async () => {
      const mkdir = vi.fn();
      const client = makeMockClient({ mkdir });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      await provider.createDirectory(makeUri('conn1', '/new-dir'));
      expect(mkdir).toHaveBeenCalledWith('/new-dir');
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.createDirectory(makeUri('unknown', '/new-dir')))
        .rejects.toThrow(/Unavailable/);
    });
  });

  // ── delete() ──────────────────────────────────────────────────────────────

  describe('delete()', () => {
    it('calls client.delete for file nodes', async () => {
      const del = vi.fn();
      const entry = makeEntry({ name: 'file.txt', type: 'file' });
      const client = makeMockClient({
        list: vi.fn(async () => [entry]),
        delete: del,
      });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      await provider.delete(makeUri('conn1', '/file.txt'), { recursive: false });
      expect(del).toHaveBeenCalledWith('/file.txt');
    });

    it('calls client.rmdir for directory nodes', async () => {
      const rmdir = vi.fn();
      const entry = makeEntry({ name: 'mydir', type: 'directory' });
      const client = makeMockClient({
        list: vi.fn(async () => [entry]),
        rmdir,
      });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      await provider.delete(makeUri('conn1', '/mydir'), { recursive: true });
      expect(rmdir).toHaveBeenCalledWith('/mydir', true);
    });

    it('fires onDidChangeFile Deleted event', async () => {
      const entry = makeEntry({ name: 'file.txt', type: 'file' });
      const client = makeMockClient({ list: vi.fn(async () => [entry]) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const uri = makeUri('conn1', '/file.txt');
      await provider.delete(uri, { recursive: false });

      const events = listener.mock.calls[0][0] as Array<{ type: number; uri: unknown }>;
      expect(events[0].type).toBe(FileChangeType.Deleted);
      expect(events[0].uri).toBe(uri);
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.delete(makeUri('unknown', '/file.txt'), { recursive: false }))
        .rejects.toThrow(/Unavailable/);
    });
  });

  // ── rename() ──────────────────────────────────────────────────────────────

  describe('rename()', () => {
    it('calls client.rename with old and new paths', async () => {
      const rename = vi.fn();
      const client = makeMockClient({ rename });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const oldUri = makeUri('conn1', '/old.txt');
      const newUri = makeUri('conn1', '/new.txt');
      await provider.rename(oldUri, newUri, { overwrite: false });

      expect(rename).toHaveBeenCalledWith('/old.txt', '/new.txt');
    });

    it('fires Deleted event for oldUri and Created event for newUri', async () => {
      const client = makeMockClient();
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const listener = vi.fn();
      provider.onDidChangeFile(listener);

      const oldUri = makeUri('conn1', '/old.txt');
      const newUri = makeUri('conn1', '/new.txt');
      await provider.rename(oldUri, newUri, { overwrite: false });

      const events = listener.mock.calls[0][0] as Array<{ type: number; uri: unknown }>;
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe(FileChangeType.Deleted);
      expect(events[0].uri).toBe(oldUri);
      expect(events[1].type).toBe(FileChangeType.Created);
      expect(events[1].uri).toBe(newUri);
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(
        provider.rename(makeUri('unknown', '/old.txt'), makeUri('unknown', '/new.txt'), { overwrite: false }),
      ).rejects.toThrow(/Unavailable/);
    });
  });

  // ── readDirectory() ───────────────────────────────────────────────────────

  describe('readDirectory()', () => {
    it('returns [name, FileType] pairs for entries', async () => {
      const entries: RemoteFileEntry[] = [
        makeEntry({ name: 'index.php', type: 'file' }),
        makeEntry({ name: 'assets', type: 'directory' }),
      ];
      const client = makeMockClient({ list: vi.fn(async () => entries) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const result = await provider.readDirectory(makeUri('conn1', '/public_html'));
      expect(result).toContainEqual(['index.php', FileType.File]);
      expect(result).toContainEqual(['assets', FileType.Directory]);
    });

    /**
     * BUG-011 Fix: readDirectory() now filters out '.' and '..' entries.
     */
    it('filters out "." and ".." entries (BUG-011 fixed)', async () => {
      const entries: RemoteFileEntry[] = [
        makeEntry({ name: '.', type: 'directory' }),
        makeEntry({ name: '..', type: 'directory' }),
        makeEntry({ name: 'index.php', type: 'file' }),
      ];
      const client = makeMockClient({ list: vi.fn(async () => entries) });
      const mgr = makeMockManager({ conn1: client });
      const provider = new FtpFileSystemProvider(mgr);

      const result = await provider.readDirectory(makeUri('conn1', '/'));
      const names = result.map(([name]) => name);
      expect(names).not.toContain('.');
      expect(names).not.toContain('..');
      expect(names).toContain('index.php');
    });

    it('throws Unavailable when no client', async () => {
      const mgr = makeMockManager({});
      const provider = new FtpFileSystemProvider(mgr);

      await expect(provider.readDirectory(makeUri('unknown', '/')))
        .rejects.toThrow(/Unavailable/);
    });
  });

  // ── watch() ───────────────────────────────────────────────────────────────

  describe('watch()', () => {
    it('returns a Disposable', () => {
      const mgr = makeMockManager();
      const provider = new FtpFileSystemProvider(mgr);

      const disposable = provider.watch(makeUri('conn1', '/'), { recursive: false, excludes: [] });
      expect(typeof disposable.dispose).toBe('function');
    });
  });

  // ── dispose() ─────────────────────────────────────────────────────────────

  describe('dispose()', () => {
    it('calls dispose on the event emitter without throwing', () => {
      const mgr = makeMockManager();
      const provider = new FtpFileSystemProvider(mgr);

      expect(() => provider.dispose()).not.toThrow();
    });
  });
});
