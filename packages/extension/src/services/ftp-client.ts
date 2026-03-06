import * as fs from 'fs';
import * as path from 'path';
import { Client as BasicFtpClient, type FileInfo } from 'basic-ftp';
import type { FtpConnectionConfig, RemoteFileEntry } from '@ftpmanager/shared';

export interface IFtpClient {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  list(remotePath: string): Promise<RemoteFileEntry[]>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  downloadFolder(remotePath: string, localPath: string): Promise<void>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  uploadFolder(localPath: string, remotePath: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  delete(remotePath: string): Promise<void>;
  rmdir(remotePath: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  getContent(remotePath: string): Promise<Buffer>;
  putContent(content: Buffer, remotePath: string): Promise<void>;
}

function mapFileInfo(info: FileInfo): RemoteFileEntry {
  return {
    name: info.name,
    type: info.isDirectory ? 'directory' : info.isSymbolicLink ? 'symlink' : 'file',
    size: info.size,
    modifiedAt: info.modifiedAt ?? new Date(0),
    permissions: info.permissions ? String(info.permissions) : undefined,
  };
}

export class FtpClient implements IFtpClient {
  private client: BasicFtpClient;

  constructor(
    private readonly config: FtpConnectionConfig,
    private readonly password?: string,
  ) {
    this.client = new BasicFtpClient();
    this.client.ftp.verbose = false;
  }

  async connect(): Promise<void> {
    await this.client.access({
      host: this.config.host,
      port: this.config.port,
      user: this.config.username,
      password: this.password,
      secure: this.config.protocol === 'ftps' || this.config.secure,
      secureOptions: this.config.protocol === 'ftps' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async disconnect(): Promise<void> {
    this.client.close();
  }

  async list(remotePath: string): Promise<RemoteFileEntry[]> {
    const items = await this.client.list(remotePath);
    return items.map(mapFileInfo);
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await this.client.downloadTo(localPath, remotePath);
  }

  async downloadFolder(remotePath: string, localPath: string): Promise<void> {
    await fs.promises.mkdir(localPath, { recursive: true });
    await this.client.downloadToDir(localPath, remotePath);
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    await this.client.uploadFrom(localPath, remotePath);
  }

  async uploadFolder(localPath: string, remotePath: string): Promise<void> {
    await this.client.uploadFromDir(localPath, remotePath);
  }

  async mkdir(remotePath: string): Promise<void> {
    await this.client.ensureDir(remotePath);
    await this.client.cd('/');
  }

  async delete(remotePath: string): Promise<void> {
    await this.client.remove(remotePath);
  }

  async rmdir(remotePath: string, _recursive: boolean): Promise<void> {
    await this.client.removeDir(remotePath);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.client.rename(oldPath, newPath);
  }

  async getContent(remotePath: string): Promise<Buffer> {
    const { PassThrough } = await import('stream');
    const chunks: Buffer[] = [];
    const pt = new PassThrough();
    pt.on('data', (chunk: Buffer) => chunks.push(chunk));
    await this.client.downloadTo(pt as unknown as fs.WriteStream, remotePath);
    return Buffer.concat(chunks);
  }

  async putContent(content: Buffer, remotePath: string): Promise<void> {
    const { Readable } = await import('stream');
    const readable = Readable.from(content);
    await this.client.uploadFrom(readable as unknown as fs.ReadStream, remotePath);
  }
}
