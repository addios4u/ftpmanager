import * as fs from 'fs';
import * as path from 'path';
import SftpClientLib from 'ssh2-sftp-client';
import type { FtpConnectionConfig, RemoteFileEntry } from '@ftpmanager/shared';
import type { IFtpClient } from './ftp-client.js';

export class SftpClient implements IFtpClient {
  private client: SftpClientLib;

  constructor(
    private readonly config: FtpConnectionConfig,
    private readonly password?: string,
    private readonly passphrase?: string,
  ) {
    this.client = new SftpClientLib();
  }

  async connect(): Promise<void> {
    const opts: SftpClientLib.ConnectOptions = {
      host: this.config.host,
      port: this.config.port,
      username: this.config.username,
    };

    if (this.config.privateKeyPath) {
      opts.privateKey = await fs.promises.readFile(this.config.privateKeyPath);
      if (this.passphrase) opts.passphrase = this.passphrase;
    } else {
      opts.password = this.password;
    }

    await this.client.connect(opts);
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
        ? `${item.rights.user}${item.rights.group}${item.rights.other}`
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

  async getContent(remotePath: string): Promise<Buffer> {
    const data = await this.client.get(remotePath);
    if (Buffer.isBuffer(data)) return data;
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
}
