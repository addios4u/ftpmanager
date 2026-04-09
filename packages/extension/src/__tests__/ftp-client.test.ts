import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FtpConnectionConfig } from '@ftpmanager/shared';

// ── basic-ftp mock ────────────────────────────────────────────────────────────
const mockFtpClient = {
  ftp: { verbose: false },
  access: vi.fn(),
  close: vi.fn(),
  list: vi.fn(async () => []),
  downloadTo: vi.fn(),
  downloadToDir: vi.fn(),
  uploadFrom: vi.fn(),
  uploadFromDir: vi.fn(),
  ensureDir: vi.fn(),
  cd: vi.fn(),
  remove: vi.fn(),
  removeDir: vi.fn(),
  rename: vi.fn(),
  send: vi.fn(async () => ({ code: 200, message: 'OK' })),
};

vi.mock('basic-ftp', () => ({
  Client: vi.fn(() => mockFtpClient),
}));

// ── fs mock ───────────────────────────────────────────────────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
    },
  };
});

import { FtpClient } from '../services/ftp-client.js';
import * as fs from 'fs';

// ── helpers ───────────────────────────────────────────────────────────────────
function makeConfig(overrides: Partial<FtpConnectionConfig> = {}): FtpConnectionConfig {
  return {
    id: 'test-id',
    name: 'Test Server',
    protocol: 'ftp',
    host: 'ftp.example.com',
    port: 21,
    username: 'testuser',
    remotePath: '/public_html',
    ...overrides,
  };
}

function makeFileInfo(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test.txt',
    isDirectory: false,
    isSymbolicLink: false,
    size: 1024,
    modifiedAt: new Date('2024-01-01'),
    permissions: undefined,
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('FtpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFtpClient.list.mockResolvedValue([]);
  });

  // ── connect() ──────────────────────────────────────────────────────────────
  describe('connect()', () => {
    it('should call client.access with host, port, user, password', async () => {
      const client = new FtpClient(makeConfig(), 'secret');
      await client.connect();
      expect(mockFtpClient.access).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'ftp.example.com',
          port: 21,
          user: 'testuser',
          password: 'secret',
        }),
      );
    });

    it('should set secure: false for plain ftp protocol', async () => {
      const client = new FtpClient(makeConfig({ protocol: 'ftp' }), 'pw');
      await client.connect();
      expect(mockFtpClient.access).toHaveBeenCalledWith(
        expect.objectContaining({ secure: false }),
      );
    });

    it('should set secure: true for ftps protocol', async () => {
      const client = new FtpClient(makeConfig({ protocol: 'ftps' }), 'pw');
      await client.connect();
      expect(mockFtpClient.access).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true }),
      );
    });

    it('should set secure: true when config.secure is true', async () => {
      const client = new FtpClient(makeConfig({ protocol: 'ftp', secure: true }), 'pw');
      await client.connect();
      expect(mockFtpClient.access).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true }),
      );
    });

    it('should set secureOptions.rejectUnauthorized: false for ftps', async () => {
      const client = new FtpClient(makeConfig({ protocol: 'ftps' }), 'pw');
      await client.connect();
      expect(mockFtpClient.access).toHaveBeenCalledWith(
        expect.objectContaining({
          secureOptions: { rejectUnauthorized: false },
        }),
      );
    });
  });

  // ── disconnect() ───────────────────────────────────────────────────────────
  describe('disconnect()', () => {
    it('should call client.close()', async () => {
      const client = new FtpClient(makeConfig());
      await client.disconnect();
      expect(mockFtpClient.close).toHaveBeenCalledOnce();
    });
  });

  // ── list() ─────────────────────────────────────────────────────────────────
  describe('list()', () => {
    it('should return RemoteFileEntry[] mapped from FileInfo[]', async () => {
      mockFtpClient.list.mockResolvedValue([makeFileInfo()]);
      const client = new FtpClient(makeConfig());
      const result = await client.list('/');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'test.txt', type: 'file', size: 1024 });
    });

    it('should map isDirectory=true to type directory', async () => {
      mockFtpClient.list.mockResolvedValue([makeFileInfo({ isDirectory: true })]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('directory');
    });

    it('should map isSymbolicLink=true to type symlink', async () => {
      mockFtpClient.list.mockResolvedValue([
        makeFileInfo({ isDirectory: false, isSymbolicLink: true }),
      ]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('symlink');
    });

    it('should map regular file to type file', async () => {
      mockFtpClient.list.mockResolvedValue([
        makeFileInfo({ isDirectory: false, isSymbolicLink: false }),
      ]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('file');
    });

    it('should use new Date(0) when modifiedAt is undefined', async () => {
      mockFtpClient.list.mockResolvedValue([makeFileInfo({ modifiedAt: undefined })]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.modifiedAt).toEqual(new Date(0));
    });

    it('should convert UnixPermissions object to octal string', async () => {
      mockFtpClient.list.mockResolvedValue([
        makeFileInfo({ permissions: { user: 6, group: 4, world: 4 } }),
      ]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.permissions).toBe('644');
    });

    it('should convert UnixPermissions 755 correctly', async () => {
      mockFtpClient.list.mockResolvedValue([
        makeFileInfo({ permissions: { user: 7, group: 5, world: 5 } }),
      ]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.permissions).toBe('755');
    });

    it('should return undefined permissions when not provided', async () => {
      mockFtpClient.list.mockResolvedValue([makeFileInfo({ permissions: undefined })]);
      const client = new FtpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.permissions).toBeUndefined();
    });
  });

  // ── chmod() ────────────────────────────────────────────────────────────────
  describe('chmod()', () => {
    it('should send SITE CHMOD command with permissions and path', async () => {
      const client = new FtpClient(makeConfig());
      await client.chmod('/remote/file.txt', '644');
      expect(mockFtpClient.send).toHaveBeenCalledWith('SITE CHMOD 644 /remote/file.txt');
    });

    it('should send SITE CHMOD for directory permissions', async () => {
      const client = new FtpClient(makeConfig());
      await client.chmod('/remote/dir', '755');
      expect(mockFtpClient.send).toHaveBeenCalledWith('SITE CHMOD 755 /remote/dir');
    });

    it('should silently ignore send errors (server may not support SITE CHMOD)', async () => {
      mockFtpClient.send.mockRejectedValueOnce(new Error('500 Unknown command'));
      const client = new FtpClient(makeConfig());
      await expect(client.chmod('/remote/file.txt', '644')).resolves.toBeUndefined();
    });

    it('should not send command for invalid permissions (injection guard)', async () => {
      const client = new FtpClient(makeConfig());
      await client.chmod('/remote/file.txt', 'abc');
      expect(mockFtpClient.send).not.toHaveBeenCalled();
    });

    it('should not send command for permissions with CRLF', async () => {
      const client = new FtpClient(makeConfig());
      await client.chmod('/remote/file.txt', '644\r\nDELE /important');
      expect(mockFtpClient.send).not.toHaveBeenCalled();
    });
  });

  // ── downloadFile() ─────────────────────────────────────────────────────────
  describe('downloadFile()', () => {
    it('should create parent directory with mkdir recursive', async () => {
      const client = new FtpClient(makeConfig());
      await client.downloadFile('/remote/file.txt', '/local/dir/file.txt');
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/local/dir', { recursive: true });
    });

    it('should call client.downloadTo with localPath and remotePath', async () => {
      const client = new FtpClient(makeConfig());
      await client.downloadFile('/remote/file.txt', '/local/file.txt');
      expect(mockFtpClient.downloadTo).toHaveBeenCalledWith('/local/file.txt', '/remote/file.txt');
    });
  });

  // ── downloadFolder() ───────────────────────────────────────────────────────
  describe('downloadFolder()', () => {
    it('should create localPath directory with mkdir recursive', async () => {
      const client = new FtpClient(makeConfig());
      await client.downloadFolder('/remote/dir', '/local/dir');
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/local/dir', { recursive: true });
    });

    it('should call client.downloadToDir', async () => {
      const client = new FtpClient(makeConfig());
      await client.downloadFolder('/remote/dir', '/local/dir');
      expect(mockFtpClient.downloadToDir).toHaveBeenCalledWith('/local/dir', '/remote/dir');
    });
  });

  // ── uploadFile() ───────────────────────────────────────────────────────────
  describe('uploadFile()', () => {
    it('should call client.uploadFrom with localPath and remotePath', async () => {
      const client = new FtpClient(makeConfig());
      await client.uploadFile('/local/file.txt', '/remote/file.txt');
      expect(mockFtpClient.uploadFrom).toHaveBeenCalledWith('/local/file.txt', '/remote/file.txt');
    });
  });

  // ── uploadFolder() ─────────────────────────────────────────────────────────
  describe('uploadFolder()', () => {
    it('should call client.uploadFromDir', async () => {
      const client = new FtpClient(makeConfig());
      await client.uploadFolder('/local/dir', '/remote/dir');
      expect(mockFtpClient.uploadFromDir).toHaveBeenCalledWith('/local/dir', '/remote/dir');
    });
  });

  // ── mkdir() ────────────────────────────────────────────────────────────────
  describe('mkdir()', () => {
    it('should call client.ensureDir with remotePath', async () => {
      const client = new FtpClient(makeConfig());
      await client.mkdir('/remote/newdir');
      expect(mockFtpClient.ensureDir).toHaveBeenCalledWith('/remote/newdir');
    });

    it('should NOT call cd() after ensureDir (BUG-009 fixed: no side effect)', async () => {
      const client = new FtpClient(makeConfig());
      await client.mkdir('/remote/newdir');
      expect(mockFtpClient.cd).not.toHaveBeenCalled();
    });
  });

  // ── delete() ───────────────────────────────────────────────────────────────
  describe('delete()', () => {
    it('should call client.remove with remotePath', async () => {
      const client = new FtpClient(makeConfig());
      await client.delete('/remote/file.txt');
      expect(mockFtpClient.remove).toHaveBeenCalledWith('/remote/file.txt');
    });
  });

  // ── rmdir() ────────────────────────────────────────────────────────────────
  describe('rmdir()', () => {
    it('should call client.removeDir with remotePath', async () => {
      const client = new FtpClient(makeConfig());
      await client.rmdir('/remote/dir', true);
      expect(mockFtpClient.removeDir).toHaveBeenCalledWith('/remote/dir');
    });

    it('should always call removeDir regardless of recursive param', async () => {
      const client = new FtpClient(makeConfig());
      await client.rmdir('/remote/dir', false);
      expect(mockFtpClient.removeDir).toHaveBeenCalledWith('/remote/dir');
    });
  });

  // ── rename() ───────────────────────────────────────────────────────────────
  describe('rename()', () => {
    it('should call client.rename with oldPath and newPath', async () => {
      const client = new FtpClient(makeConfig());
      await client.rename('/remote/old.txt', '/remote/new.txt');
      expect(mockFtpClient.rename).toHaveBeenCalledWith('/remote/old.txt', '/remote/new.txt');
    });
  });

  // ── getContent() ───────────────────────────────────────────────────────────
  describe('getContent()', () => {
    it('should return Buffer containing file content', async () => {
      const fileData = Buffer.from('hello world');
      mockFtpClient.downloadTo.mockImplementation(async (dest: NodeJS.WritableStream) => {
        dest.write(fileData);
        dest.end();
      });
      const client = new FtpClient(makeConfig());
      const result = await client.getContent('/remote/file.txt');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('hello world');
    });

    it('should handle stream data correctly', async () => {
      const chunk1 = Buffer.from('foo');
      const chunk2 = Buffer.from('bar');
      mockFtpClient.downloadTo.mockImplementation(async (dest: NodeJS.WritableStream) => {
        dest.write(chunk1);
        dest.write(chunk2);
        dest.end();
      });
      const client = new FtpClient(makeConfig());
      const result = await client.getContent('/remote/file.txt');
      expect(result.toString()).toBe('foobar');
    });
  });

  // ── putContent() ───────────────────────────────────────────────────────────
  describe('putContent()', () => {
    it('should upload content as readable stream', async () => {
      const client = new FtpClient(makeConfig());
      const content = Buffer.from('upload me');
      await client.putContent(content, '/remote/file.txt');
      expect(mockFtpClient.uploadFrom).toHaveBeenCalledWith(
        expect.anything(),
        '/remote/file.txt',
      );
    });
  });
});
