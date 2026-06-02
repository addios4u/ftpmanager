import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { randomUUID } from 'crypto';
import type { IFtpClient } from '../services/ftp-client.js';
import type { ConnectionManager } from '../services/connection-manager.js';
import type { RemoteFileEntry } from '@ftpmanager/shared';

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
  private readonly remoteBaselines = new Map<string, { mtime: number; size: number }>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly statusBarItem?: vscode.StatusBarItem,
  ) {}

  watch(_uri: vscode.Uri, _options: { recursive: boolean; excludes: readonly string[] }): vscode.Disposable {
    return new vscode.Disposable(() => { /* no-op */ });
  }

  private async withAutoReconnect<T>(
    connectionId: string,
    fn: (client: IFtpClient) => Promise<T>,
    _remotePath?: string,
  ): Promise<T> {
    let client = this.connectionManager.getClient(connectionId);
    if (!client) {
      const connection = this.connectionManager.getConnection(connectionId);
      const connectionName = connection?.name ?? connectionId;
      try {
        await this.connectionManager.connect(connectionId);
        client = this.connectionManager.getClient(connectionId);
      } catch (err) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Connection lost for "{0}": {1}',
            connectionName,
            err instanceof Error ? err.message : String(err),
          ),
          vscode.l10n.t('Retry'),
          vscode.l10n.t('Edit connection'),
        ).then(async (choice) => {
          if (choice === vscode.l10n.t('Retry')) {
            try {
              await this.connectionManager.reconnect(connectionId);
            } catch (retryErr) {
              vscode.window.showErrorMessage(
                vscode.l10n.t(
                  'Failed to reconnect "{0}": {1}',
                  connectionName,
                  retryErr instanceof Error ? retryErr.message : String(retryErr),
                ),
              );
            }
          } else if (choice === vscode.l10n.t('Edit connection')) {
            void vscode.commands.executeCommand('ftpmanager.editServer', { connectionId });
          }
        });
        throw err;
      }
      if (!client) throw vscode.FileSystemError.Unavailable(connectionId);
    }

    try {
      return await fn(client);
    } catch (err) {
      if (!isStaleConnectionError(err)) throw err;

      const connection = this.connectionManager.getConnection(connectionId);
      const connectionName = connection?.name ?? connectionId;

      try {
        await this.connectionManager.reconnect(connectionId);
        const freshClient = this.connectionManager.getClient(connectionId);
        if (!freshClient) throw vscode.FileSystemError.Unavailable(connectionId);
        return await fn(freshClient);
      } catch (reconnectErr) {
        void vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Connection lost for "{0}": {1}',
            connectionName,
            reconnectErr instanceof Error ? reconnectErr.message : String(reconnectErr),
          ),
          vscode.l10n.t('Retry'),
          vscode.l10n.t('Edit connection'),
        ).then(async (choice) => {
          if (choice === vscode.l10n.t('Retry')) {
            try {
              await this.connectionManager.reconnect(connectionId);
            } catch (retryErr) {
              vscode.window.showErrorMessage(
                vscode.l10n.t(
                  'Failed to reconnect "{0}": {1}',
                  connectionName,
                  retryErr instanceof Error ? retryErr.message : String(retryErr),
                ),
              );
            }
          } else if (choice === vscode.l10n.t('Edit connection')) {
            void vscode.commands.executeCommand('ftpmanager.editServer', { connectionId });
          }
        });
        throw reconnectErr;
      }
    }
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { connectionId, remotePath } = this.parseUri(uri);

    if (remotePath === '/' || remotePath === '') {
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    return this.withAutoReconnect(connectionId, async (client) => {
      const entry = await this.getRemoteEntry(client, remotePath);
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      this.rememberBaseline(uri, entry);
      return {
        type: entry.type === 'directory' ? vscode.FileType.Directory : vscode.FileType.File,
        ctime: 0,
        mtime: entry.modifiedAt.getTime(),
        size: entry.size,
      };
    }, remotePath);
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
    }, remotePath);
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { connectionId, remotePath } = this.parseUri(uri);
    return this.withAutoReconnect(connectionId, async (client) => {
      const content = await client.getContent(remotePath);
      const entry = await this.getRemoteEntry(client, remotePath);
      this.rememberBaseline(uri, entry);
      return new Uint8Array(content);
    }, remotePath);
  }

  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);

    await this.withAutoReconnect(connectionId, async (client) => {
      let originalPerms: string | undefined;
      let currentEntry: RemoteFileEntry | undefined;

      if (!options.create || options.overwrite) {
        currentEntry = await this.getRemoteEntry(client, remotePath);
        originalPerms = currentEntry?.permissions;
      }

      const baseline = this.remoteBaselines.get(uri.toString());
      if (baseline && currentEntry && currentEntry.type !== 'directory') {
        const currentMtime = currentEntry.modifiedAt?.getTime?.() ?? 0;
        const currentSize = currentEntry.size ?? 0;
        const changedByTime = currentMtime && baseline.mtime && currentMtime > baseline.mtime + 2000;
        const changedBySize = currentSize !== baseline.size && currentMtime !== baseline.mtime;

        if (changedByTime || changedBySize) {
          const connection = this.connectionManager.getConnection(connectionId);
          const serverName = connection?.name ?? connectionId;
          const choice = await vscode.window.showWarningMessage(
            vscode.l10n.t(
              'The remote file "{0}" on {1} changed since it was opened. Overwrite it?',
              path.posix.basename(remotePath),
              serverName,
            ),
            { modal: true },
            vscode.l10n.t('Overwrite'),
            vscode.l10n.t('Compare'),
            vscode.l10n.t('Cancel'),
          );

          if (choice === vscode.l10n.t('Compare')) {
            await this.openRemoteOverwriteDiff(client, remotePath, content);
            throw vscode.FileSystemError.NoPermissions(uri);
          }

          if (choice !== vscode.l10n.t('Overwrite')) {
            throw vscode.FileSystemError.NoPermissions(uri);
          }
        }
      }

      await client.putContent(Buffer.from(content), remotePath);

      if (originalPerms) {
        await client.chmod(remotePath, originalPerms).catch(() => {});
      }

      const updatedEntry = await this.getRemoteEntry(client, remotePath);
      this.rememberBaseline(uri, updatedEntry);
    }, remotePath);

    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    this.showUploadFeedback(connectionId, remotePath);
  }

  async createDirectory(uri: vscode.Uri): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    await this.withAutoReconnect(connectionId, (client) => client.mkdir(remotePath), remotePath);
  }

  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const { connectionId, remotePath } = this.parseUri(uri);
    const stat = await this.stat(uri);
    await this.withAutoReconnect(connectionId, async (client) => {
      if (stat.type === vscode.FileType.Directory) {
        await client.rmdir(remotePath, options.recursive);
      } else {
        await client.delete(remotePath);
      }
    }, remotePath);
    this._onDidChangeFile.fire([{ type: vscode.FileChangeType.Deleted, uri }]);
  }

  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    _options: { overwrite: boolean },
  ): Promise<void> {
    const { connectionId, remotePath: oldPath } = this.parseUri(oldUri);
    const { remotePath: newPath } = this.parseUri(newUri);
    await this.withAutoReconnect(connectionId, (client) => client.rename(oldPath, newPath), oldPath);
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

  private async getRemoteEntry(client: IFtpClient, remotePath: string): Promise<RemoteFileEntry | undefined> {
    const parentPath = path.posix.dirname(remotePath);
    const name = path.posix.basename(remotePath);
    try {
      const entries = await client.list(parentPath);
      return entries.find((entry) => entry.name === name);
    } catch {
      return undefined;
    }
  }

  private rememberBaseline(uri: vscode.Uri, entry: RemoteFileEntry | undefined): void {
    if (!entry) return;
    this.remoteBaselines.set(uri.toString(), {
      mtime: entry.modifiedAt?.getTime?.() ?? 0,
      size: entry.size ?? 0,
    });
  }

  private async openRemoteOverwriteDiff(
    client: IFtpClient,
    remotePath: string,
    localContent: Uint8Array,
  ): Promise<void> {
    const fileName = path.posix.basename(remotePath) || 'remote-file';
    const tempRoot = vscode.Uri.file(path.join(os.tmpdir(), `ftpmanager-compare-${randomUUID()}`));
    await vscode.workspace.fs.createDirectory(tempRoot);

    const remoteTemp = vscode.Uri.joinPath(tempRoot, `remote-${fileName}`);
    const localTemp = vscode.Uri.joinPath(tempRoot, `local-${fileName}`);
    const remoteContent = await client.getContent(remotePath);

    await vscode.workspace.fs.writeFile(remoteTemp, new Uint8Array(remoteContent));
    await vscode.workspace.fs.writeFile(localTemp, localContent);
    await vscode.commands.executeCommand(
      'vscode.diff',
      remoteTemp,
      localTemp,
      vscode.l10n.t('Remote vs Local: {0}', fileName),
    );
  }

  private showUploadFeedback(connectionId: string, remotePath: string): void {
    const connection = this.connectionManager.getConnection(connectionId);
    const serverName = connection?.name ?? connectionId;
    const fileName = path.posix.basename(remotePath);
    const savedAt = new Date().toLocaleTimeString();

    if (this.statusBarItem) {
      this.statusBarItem.text = `$(cloud-upload) FTPManager: ${fileName} saved ${savedAt}`;
      this.statusBarItem.tooltip = `${serverName}${remotePath}\nLast remote save: ${savedAt}`;
      this.statusBarItem.show();
    }

    vscode.window.showInformationMessage(
      `✓ ${fileName} uploaded to ${serverName}`,
    );
  }

  dispose(): void {
    this._onDidChangeFile.dispose();
  }
}
