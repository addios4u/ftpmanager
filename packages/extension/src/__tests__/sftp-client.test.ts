import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FtpConnectionConfig } from '@ftpmanager/shared';
import { Readable } from 'stream';

// ── ssh2-sftp-client mock ─────────────────────────────────────────────────────
const mockSftpClient = {
  connect: vi.fn(),
  end: vi.fn(),
  list: vi.fn(async () => []),
  fastGet: vi.fn(),
  fastPut: vi.fn(),
  downloadDir: vi.fn(),
  uploadDir: vi.fn(),
  mkdir: vi.fn(),
  delete: vi.fn(),
  rmdir: vi.fn(),
  rename: vi.fn(),
  get: vi.fn(async () => Buffer.from('content')),
  put: vi.fn(),
};

vi.mock('ssh2-sftp-client', () => ({
  default: vi.fn(() => mockSftpClient),
}));

// ── fs mock ───────────────────────────────────────────────────────────────────
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: vi.fn(),
      readFile: vi.fn(async () => Buffer.from('PRIVATE_KEY_CONTENT')),
    },
  };
});

import { SftpClient } from '../services/sftp-client.js';
import * as fs from 'fs';

// ── helpers ───────────────────────────────────────────────────────────────────
function makeConfig(overrides: Partial<FtpConnectionConfig> = {}): FtpConnectionConfig {
  return {
    id: 'test-id',
    name: 'Test SFTP Server',
    protocol: 'sftp',
    host: 'sftp.example.com',
    port: 22,
    username: 'testuser',
    remotePath: '/home/testuser',
    ...overrides,
  };
}

function makeSftpFileInfo(overrides: Record<string, unknown> = {}) {
  return {
    name: 'test.txt',
    type: '-',
    size: 1024,
    modifyTime: new Date('2024-01-01').getTime(),
    rights: { user: 'rwx', group: 'r-x', other: 'r--' },
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe('SftpClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSftpClient.list.mockResolvedValue([]);
    mockSftpClient.get.mockResolvedValue(Buffer.from('content'));
  });

  // ── connect() ──────────────────────────────────────────────────────────────
  describe('connect()', () => {
    it('should connect with username and password', async () => {
      const client = new SftpClient(makeConfig(), 'mypassword');
      await client.connect();
      expect(mockSftpClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'sftp.example.com',
          port: 22,
          username: 'testuser',
          password: 'mypassword',
        }),
      );
    });

    it('should connect with privateKey when privateKeyPath is set', async () => {
      const client = new SftpClient(
        makeConfig({ privateKeyPath: '/home/user/.ssh/id_rsa' }),
        undefined,
      );
      await client.connect();
      expect(mockSftpClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          privateKey: Buffer.from('PRIVATE_KEY_CONTENT'),
        }),
      );
    });

    it('should include passphrase when privateKey and passphrase provided', async () => {
      const client = new SftpClient(
        makeConfig({ privateKeyPath: '/home/user/.ssh/id_rsa' }),
        undefined,
        'my-passphrase',
      );
      await client.connect();
      expect(mockSftpClient.connect).toHaveBeenCalledWith(
        expect.objectContaining({
          passphrase: 'my-passphrase',
        }),
      );
    });

    it('should NOT include password when privateKeyPath is set', async () => {
      const client = new SftpClient(
        makeConfig({ privateKeyPath: '/home/user/.ssh/id_rsa' }),
        'should-not-be-used',
      );
      await client.connect();
      const callArg = mockSftpClient.connect.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg).not.toHaveProperty('password');
    });
  });

  // ── disconnect() ───────────────────────────────────────────────────────────
  describe('disconnect()', () => {
    it('should call client.end()', async () => {
      const client = new SftpClient(makeConfig());
      await client.disconnect();
      expect(mockSftpClient.end).toHaveBeenCalledOnce();
    });
  });

  // ── list() ─────────────────────────────────────────────────────────────────
  describe('list()', () => {
    it('should return RemoteFileEntry[] mapped from sftp FileInfo', async () => {
      mockSftpClient.list.mockResolvedValue([makeSftpFileInfo()]);
      const client = new SftpClient(makeConfig());
      const result = await client.list('/home/testuser');
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ name: 'test.txt', type: 'file', size: 1024 });
    });

    it('should map type d to directory', async () => {
      mockSftpClient.list.mockResolvedValue([makeSftpFileInfo({ type: 'd' })]);
      const client = new SftpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('directory');
    });

    it('should map type l to symlink', async () => {
      mockSftpClient.list.mockResolvedValue([makeSftpFileInfo({ type: 'l' })]);
      const client = new SftpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('symlink');
    });

    it('should map other types to file', async () => {
      mockSftpClient.list.mockResolvedValue([makeSftpFileInfo({ type: '-' })]);
      const client = new SftpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.type).toBe('file');
    });

    it('should format permissions from rights object', async () => {
      mockSftpClient.list.mockResolvedValue([
        makeSftpFileInfo({ rights: { user: 'rwx', group: 'r-x', other: 'r--' } }),
      ]);
      const client = new SftpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.permissions).toBe('rwxr-xr--');
    });

    it('should handle undefined rights gracefully', async () => {
      mockSftpClient.list.mockResolvedValue([makeSftpFileInfo({ rights: undefined })]);
      const client = new SftpClient(makeConfig());
      const [entry] = await client.list('/');
      expect(entry.permissions).toBeUndefined();
    });
  });

  // ── downloadFile() ─────────────────────────────────────────────────────────
  describe('downloadFile()', () => {
    it('should create parent directory', async () => {
      const client = new SftpClient(makeConfig());
      await client.downloadFile('/remote/file.txt', '/local/dir/file.txt');
      expect(fs.promises.mkdir).toHaveBeenCalledWith('/local/dir', { recursive: true });
    });

    it('should call client.fastGet with remotePath and localPath', async () => {
      const client = new SftpClient(makeConfig());
      await client.downloadFile('/remote/file.txt', '/local/file.txt');
      expect(mockSftpClient.fastGet).toHaveBeenCalledWith('/remote/file.txt', '/local/file.txt');
    });
  });

  // ── downloadFolder() ───────────────────────────────────────────────────────
  describe('downloadFolder()', () => {
    it('should call client.downloadDir', async () => {
      const client = new SftpClient(makeConfig());
      await client.downloadFolder('/remote/dir', '/local/dir');
      expect(mockSftpClient.downloadDir).toHaveBeenCalledWith('/remote/dir', '/local/dir');
    });
  });

  // ── uploadFile() ───────────────────────────────────────────────────────────
  describe('uploadFile()', () => {
    it('should call client.fastPut with localPath and remotePath', async () => {
      const client = new SftpClient(makeConfig());
      await client.uploadFile('/local/file.txt', '/remote/file.txt');
      expect(mockSftpClient.fastPut).toHaveBeenCalledWith('/local/file.txt', '/remote/file.txt');
    });
  });

  // ── uploadFolder() ─────────────────────────────────────────────────────────
  describe('uploadFolder()', () => {
    it('should call client.uploadDir', async () => {
      const client = new SftpClient(makeConfig());
      await client.uploadFolder('/local/dir', '/remote/dir');
      expect(mockSftpClient.uploadDir).toHaveBeenCalledWith('/local/dir', '/remote/dir');
    });
  });

  // ── mkdir() ────────────────────────────────────────────────────────────────
  describe('mkdir()', () => {
    it('should call client.mkdir with remotePath and recursive=true', async () => {
      const client = new SftpClient(makeConfig());
      await client.mkdir('/remote/newdir');
      expect(mockSftpClient.mkdir).toHaveBeenCalledWith('/remote/newdir', true);
    });
  });

  // ── delete() ───────────────────────────────────────────────────────────────
  describe('delete()', () => {
    it('should call client.delete with remotePath', async () => {
      const client = new SftpClient(makeConfig());
      await client.delete('/remote/file.txt');
      expect(mockSftpClient.delete).toHaveBeenCalledWith('/remote/file.txt');
    });
  });

  // ── rmdir() ────────────────────────────────────────────────────────────────
  describe('rmdir()', () => {
    it('should call client.rmdir with remotePath and true (ignores recursive param)', async () => {
      const client = new SftpClient(makeConfig());
      await client.rmdir('/remote/dir', false);
      expect(mockSftpClient.rmdir).toHaveBeenCalledWith('/remote/dir', true);
    });
  });

  // ── rename() ───────────────────────────────────────────────────────────────
  describe('rename()', () => {
    it('should call client.rename with oldPath and newPath', async () => {
      const client = new SftpClient(makeConfig());
      await client.rename('/remote/old.txt', '/remote/new.txt');
      expect(mockSftpClient.rename).toHaveBeenCalledWith('/remote/old.txt', '/remote/new.txt');
    });
  });

  // ── getContent() ───────────────────────────────────────────────────────────
  describe('getContent()', () => {
    it('should return Buffer directly when client.get returns Buffer', async () => {
      const buf = Buffer.from('direct buffer');
      mockSftpClient.get.mockResolvedValue(buf);
      const client = new SftpClient(makeConfig());
      const result = await client.getContent('/remote/file.txt');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect(result.toString()).toBe('direct buffer');
    });

    it('should collect stream chunks when client.get returns a stream', async () => {
      const readable = new Readable({ read() {} });
      mockSftpClient.get.mockResolvedValue(readable);
      const client = new SftpClient(makeConfig());
      const resultPromise = client.getContent('/remote/file.txt');
      readable.push(Buffer.from('chunk1'));
      readable.push(Buffer.from('chunk2'));
      readable.push(null);
      const result = await resultPromise;
      expect(result.toString()).toBe('chunk1chunk2');
    });
  });

  // ── putContent() ───────────────────────────────────────────────────────────
  describe('putContent()', () => {
    it('should call client.put with content Buffer and remotePath', async () => {
      const client = new SftpClient(makeConfig());
      const content = Buffer.from('upload content');
      await client.putContent(content, '/remote/file.txt');
      expect(mockSftpClient.put).toHaveBeenCalledWith(content, '/remote/file.txt');
    });
  });
});
