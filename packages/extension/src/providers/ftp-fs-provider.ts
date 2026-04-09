import * as vscode from 'vscode';
import * as path from 'path';
import type { IFtpClient } from '../services/ftp-client.js';
import type { ConnectionManager } from '../services/connection-manager.js';

function isStaleConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /client is closed|FIN packet|ECONNRESET|ETIMEDOUT|ENOTCONN|socket hang up|connection lost|No response from server/i.test(msg);
}

/**
 * FileSystemProvider for ftpmanager:// URIs.
 * URI format: ftpmanager://<connectionId><remotePath>
 * Example:    ftpmanager://abc123/public_html/index.php
 */
export class FtpFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  constructor(private readonly connectionManager: ConnectionManager) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => { /* no-op */ });
  }

  /**
   * Runs `fn` with an active client. If the operation throws a stale-connection
   * error (server sent FIN, ECONNRESET, etc.), reconnects once and retries.
   */
  private async withAutoReconnect<T>(
    connectionId: string,
    fn: (client: IFtpClient) => Promise<T>,
  ): Promise<T> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(connectionId);
    try {
      return await fn(client);
    } catch (err) {
      if (!isStaleConnectionError(err)) throw err;
      await this.connectionManager.reconnect(connectionId);
      const freshClient = this.connectionManager.getClient(connectionId);
      if (!freshClient) throw vscode.FileSystemError.Unavailable(connectionId);
      return await fn(freshClient);
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, remotePath } = this.parseUri(uri);

    // Root path '/' has no parent to list — return a directory stat directly
    if (remotePath === '/' || remotePath === '') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const parentPath = path.posix.dirname(remotePath);
    const name = path.posix.basename(remotePath);

    return this.withAutoReconnect(connectionId, async (client) => {
      const entries = await client.list(parentPath);
      const entry = entries.find((e) => e.name === name);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      return {
        type: entry.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: 0,
        mtime: entry.modifiedAt.getTime(),
        size: entry.size,
      };
    });
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { connectionId, remotePath } = this.parseUri(uri);
    return this.withAutoReconnect(connectionId, async (client) => {
      const entries = await client.list(remotePath);
      return entries
        .filter((e) => e.name !== '.' && e.name !== '..')
        .map((e) => [
          e.name,
          e.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
        ]);
    });
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, remotePath } = this.parseUri(uri);
    return this.withAutoReconnect(connectionId, async (client) => {
      const content = await client.getContent(remotePath);
      return new Uint8Array(content);
    });
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);

    await this.withAutoReconnect(connectionId, async (client) => {
      // 기존 파일이 있을 수 있는 경우에만 퍼미션 조회
      // create:false(덮어쓰기 전용) 또는 create:true,overwrite:true(기존 파일 덮어쓰기 허용) 모두 해당
      let originalPerms: string | undefined;
      if (!options.create || options.overwrite) {
        try {
          const parentDir = path.posix.dirname(remotePath);
          const fileName = path.posix.basename(remotePath);
          const entries = await client.list(parentDir);
          originalPerms = entries.find((e) => e.name === fileName)?.permissions;
        } catch {
          // 조회 실패 시 퍼미션 없이 계속 진행
        }
      }

      await client.putContent(Buffer.from(content), remotePath);

      if (originalPerms) {
        await client.chmod(remotePath, originalPerms).catch(() => {});
      }
    });

    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    await this.withAutoReconnect(connectionId, (client) => client.mkdir(remotePath));
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const stat = await this.stat(uri); // already auto-reconnects if needed
    await this.withAutoReconnect(connectionId, async (client) => {
      if (stat.type === vscode.FileType.Directory) {
        await client.rmdir(remotePath, options.recursive);
      } else {
        await client.delete(remotePath);
      }
    });
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    _options: { overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath: oldPath } = this.parseUri(oldUri);
    const { remotePath: newPath } = this.parseUri(newUri);
    await this.withAutoReconnect(connectionId, (client) => client.rename(oldPath, newPath));
    this._onDidChangeFile.fire([
      { type: vscode.FileChangeType.Deleted, uri: oldUri },
      { type: vscode.FileChangeType.Created, uri: newUri },
    ]);
  }

  private parseUri(uri: vscode.Uri): { connectionId: string; remotePath: string } {
    const connectionId = uri.authority;
    const remotePath = uri.path || '/';
    return { connectionId, remotePath };
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
  }
}
