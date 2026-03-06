import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { PassThrough, Readable } from 'stream';
import { Client as BasicFtpClient, type FileInfo, enterPassiveModeIPv4, enterPassiveModeIPv6 } from 'basic-ftp';
import type { FtpConnectionConfig, RemoteFileEntry } from '@ftpmanager/shared';

export interface IFtpClient {
  connect(signal?: AbortSignal): Promise<void>;
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
  pwd(): Promise<string>;
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

let ftpOutputChannel: vscode.OutputChannel | undefined;
function getFtpChannel(): vscode.OutputChannel {
  if (!ftpOutputChannel) {
    ftpOutputChannel = vscode.window.createOutputChannel('FTP Manager');
  }
  return ftpOutputChannel;
}

export class FtpClient implements IFtpClient {
  private client: BasicFtpClient;

  constructor(
    private readonly config: FtpConnectionConfig,
    private readonly password?: string,
  ) {
    this.client = new BasicFtpClient();
    this.client.ftp.verbose = false;
    this.client.ftp.log = (msg: string) => getFtpChannel().appendLine(msg);
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.client.ftp.timeout = 8_000; // 8s per attempt: EPSV(8s)+PASV(8s)=16s < 25s global
    // Try EPSV first (uses control connection IP — no NAT/PASV IP issues),
    // fall back to standard PASV if server doesn't support EPSV.
    this.client.prepareTransfer = async (ftp) => {
      try {
        return await enterPassiveModeIPv6(ftp);
      } catch {
        return await enterPassiveModeIPv4(ftp);
      }
    };
    const accessPromise = this.client.access({
      host: this.config.host,
      port: this.config.port,
      user: this.config.username,
      password: this.password,
      secure: !!(this.config.protocol === 'ftps' || this.config.secure),
      secureOptions: this.config.protocol === 'ftps' ? { rejectUnauthorized: false } : undefined,
    });
    if (!signal) { await accessPromise; return; }
    await Promise.race([
      accessPromise,
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => { this.client.close(); reject(new Error('Cancelled')); }, { once: true }),
      ),
    ]);
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

  async pwd(): Promise<string> {
    return this.client.pwd();
  }

  async getContent(remotePath: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const pt = new PassThrough();
    pt.on('data', (chunk: Buffer) => chunks.push(chunk));
    await this.client.downloadTo(pt as unknown as fs.WriteStream, remotePath);
    return Buffer.concat(chunks);
  }

  async putContent(content: Buffer, remotePath: string): Promise<void> {
    const readable = Readable.from(content);
    await this.client.uploadFrom(readable as unknown as fs.ReadStream, remotePath);
  }
}
