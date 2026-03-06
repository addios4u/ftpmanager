import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import type { ConnectionManager } from '../services/connection-manager.js';

/**
 * FileSystemProvider for ftpmanager:// URIs.
 * URI format: ftpmanager://<connectionId><remotePath>
 * Example:    ftpmanager://abc123/public_html/index.php
 */
export class FtpFileSystemProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this._onDidChangeFile.event;

  private readonly cache = new Map<string, string>();

  constructor(private readonly connectionManager: ConnectionManager) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => { /* no-op */ });
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);

    // Root path '/' has no parent to list — return a directory stat directly
    if (remotePath === '/' || remotePath === '') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    const parentPath = path.posix.dirname(remotePath);
    const name = path.posix.basename(remotePath);
    const entries = await client.list(parentPath);
    const entry = entries.find((e) => e.name === name);

    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);

    return {
      type: entry.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
      ctime: 0,
      mtime: entry.modifiedAt.getTime(),
      size: entry.size,
    };
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);

    const entries = await client.list(remotePath);
    return entries.map((e) => [
      e.name,
      e.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
    ]);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);

    const content = await client.getContent(remotePath);
    return new Uint8Array(content);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    _options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);

    await client.putContent(Buffer.from(content), remotePath);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);
    await client.mkdir(remotePath);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(uri);

    const stat = await this.stat(uri);
    if (stat.type === vscode.FileType.Directory) {
      await client.rmdir(remotePath, options.recursive);
    } else {
      await client.delete(remotePath);
    }
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    _options: { overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath: oldPath } = this.parseUri(oldUri);
    const { remotePath: newPath } = this.parseUri(newUri);
    const client = this.connectionManager.getClient(connectionId);
    if (!client) throw vscode.FileSystemError.Unavailable(oldUri);
    await client.rename(oldPath, newPath);
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
    for (const [, tmpPath] of this.cache) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    this.cache.clear();
    this._onDidChangeFile.dispose();
  }
}
