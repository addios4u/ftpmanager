import * as fs from 'fs';
import * as path from 'path';
import SftpClientLib from 'ssh2-sftp-client';
import type { FtpConnectionConfig, RemoteFileEntry } from '@ftpmanager/shared';
import type { IFtpClient } from './ftp-client.js';

/** "rwx" 형식 심볼릭 퍼미션 → 8진수 숫자 (0-7) */
function rightsToOctal(rights: string): number {
  return (rights.includes('r') ? 4 : 0) + (rights.includes('w') ? 2 : 0) + (rights.includes('x') ? 1 : 0);
}

export class SftpClient implements IFtpClient {
  private client: SftpClientLib;

  constructor(
    private readonly config: FtpConnectionConfig,
    private readonly password?: string,
    private readonly passphrase?: string,
  ) {
    this.client = new SftpClientLib();
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const opts: SftpClientLib.ConnectOptions = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
      readyTimeout: 15_000,
    };

    if (this.config.privateKeyPath) {
      opts.privateKey = await fs.promises.readFile(this.config.privateKeyPath);
      if (this.passphrase) opts.passphrase = this.passphrase;
    } else {
      opts.password = this.password;
    }

    const connectPromise = this.client.connect(opts);
    if (!signal) { await connectPromise; return; }
    await Promise.race([
      connectPromise,
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => {
          void this.client.end().catch(() => {});
          reject(new Error('Cancelled'));
        }, { once: true }),
      ),
    ]);
  }

  async disconnect(): Promise<void> {
    await this.client.end();
  }

  async list(remotePath: string): Promise<RemoteFileEntry[]> {
    const items = await this.client.list(remotePath);
    return items.map((item) => ({
      name: item.name,
      type: item.type === 'd' ? 'directory' : item.type === 'l' ? 'symlink' : 'file',
      size: item.size,
      modifiedAt: new Date(item.modifyTime),
      permissions: item.rights
        ? `${rightsToOctal(item.rights.user)}${rightsToOctal(item.rights.group)}${rightsToOctal(item.rights.other)}`
        : undefined,
    }));
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await this.client.fastGet(remotePath, localPath);
  }

  async downloadFolder(remotePath: string, localPath: string): Promise<void> {
    await this.client.downloadDir(remotePath, localPath);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.client.fastPut(localPath, remotePath);
  }

  async uploadFolder(localPath: string, remotePath: string): Promise<void> {
    await this.client.uploadDir(localPath, remotePath);
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.client.mkdir(remotePath, true);
  }

  async delete(remotePath: string): Promise<void> {
    await this.client.delete(remotePath);
  }

  async rmdir(remotePath: string, recursive: boolean): Promise<void> {
    await this.client.rmdir(remotePath, recursive);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.client.rename(oldPath, newPath);
  }

  async pwd(): Promise<string> {
    const result = await this.client.realPath('.');
    return result;
  }

  async getContent(remotePath: string): Promise<Buffer> {
    const data = await this.client.get(remotePath);
    if (Buffer.isBuffer(data)) return data;
    // concat-stream returns Array when no data is written (empty file)
    if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
    // Fallback: treat as readable stream
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = data as unknown as NodeJS.ReadableStream;
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    return Buffer.concat(chunks);
  }

  async putContent(content: Buffer, remotePath: string): Promise<void> {
    await this.client.put(content, remotePath);
  }

  async chmod(remotePath: string, permissions: string): Promise<void> {
    const mode = parseInt(permissions, 8); // "644" → 0o644
    if (isNaN(mode)) return;
    await this.client.chmod(remotePath, mode);
  }
}
