import * as vscode from 'vscode';
import * as path from 'path';
import type { ConnectionManager } from '../services/connection-manager.js';
import { pickPermissions } from '../utils/pick-permissions.js';
import { runtimeT } from '../i18n.js';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

function isClosedConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /client is closed|FIN packet|ECONNRESET|ETIMEDOUT|ENOTCONN|socket hang up|connection lost|No response from server/i.test(msg);
}

export type FtpNodeType =
  | 'openedFiles'
  | 'openedFile'
  | 'recentFiles'
  | 'recentFile'
  | 'group'
  | 'server'
  | 'directory'
  | 'file';

export interface FtpTreeNode {
  nodeType: FtpNodeType;
  label: string;
  connectionId: string;
  remotePath: string;
  permissions?: string;
  group?: string;
  description?: string;
}

function getContextValue(node: FtpTreeNode, connectionManager: ConnectionManager): string {
  if (node.nodeType === 'server') {
    return connectionManager.isConnected(node.connectionId)
      ? 'server-connected'
      : 'server-disconnected';
  }
  return node.nodeType;
}

function getCollapsibleState(nodeType: FtpNodeType): vscode.TreeItemCollapsibleState {
  switch (nodeType) {
    case 'group':
    case 'server':
    case 'directory':
    case 'recentFiles':
      return vscode.TreeItemCollapsibleState.Collapsed;
    default:
      return vscode.TreeItemCollapsibleState.None;
  }
}

function getIcon(
  node: FtpTreeNode,
  connectionManager: ConnectionManager,
  extensionUri: vscode.Uri,
): vscode.ThemeIcon | { light: vscode.Uri; dark: vscode.Uri } {
  if (node.nodeType === 'openedFiles') {
    return new vscode.ThemeIcon('files');
  }
  if (node.nodeType === 'recentFiles') {
    return new vscode.ThemeIcon('history');
  }
  if (node.nodeType === 'group') {
    return new vscode.ThemeIcon('folder-library');
  }
  if (node.nodeType === 'server') {
    const protocol = connectionManager.getConnection(node.connectionId)?.protocol ?? 'ftp';
    const baseName = protocol === 'sftp' ? 'sftp' : 'ftp';
    const light = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', `${baseName}-light.svg`);
    const dark = vscode.Uri.joinPath(extensionUri, 'resources', 'icons', `${baseName}-dark.svg`);
    return { light, dark };
  }
  if (node.nodeType === 'directory') return new vscode.ThemeIcon('folder');
  return new vscode.ThemeIcon('file');
}

const DRAG_MIME = 'application/vnd.code.tree.ftpmanager.servers';

export class FtpTreeProvider
  implements vscode.TreeDataProvider<FtpTreeNode>, vscode.TreeDragAndDropController<FtpTreeNode>
{
  readonly dropMimeTypes = [DRAG_MIME, 'text/uri-list'];
  readonly dragMimeTypes = [DRAG_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FtpTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly connectingIds = new Set<string>();
  private readonly disconnectGen = new Map<string, number>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri,
    private readonly getOpenRemoteFileUris: () => string[] = () => [],
    private readonly getRecentRemoteFileUris: () => string[] = () => [],
    private readonly shouldShowOpenedFiles: () => boolean = () => false,
  ) {
    this.connectionManager.onDidChangeConnections(() => this._onDidChangeTreeData.fire(null));
    this.connectionManager.onDidChangeConnectionState(({ connectionId, connected }) => {
      if (!connected) {
        this.disconnectGen.set(connectionId, (this.disconnectGen.get(connectionId) ?? 0) + 1);
      }
      this._onDidChangeTreeData.fire(null);
    });
  }

  refresh(node?: FtpTreeNode): void {
    this._onDidChangeTreeData.fire(node ?? null);
  }

  handleDrag(source: readonly FtpTreeNode[], dataTransfer: vscode.DataTransfer): void {
    const serverNodes = source.filter((n) => n.nodeType === 'server');
    if (serverNodes.length === 0) return;
    dataTransfer.set(DRAG_MIME, new vscode.DataTransferItem(serverNodes.map((n) => n.connectionId)));
  }

  async handleDrop(target: FtpTreeNode | undefined, dataTransfer: vscode.DataTransfer): Promise<void> {
    // OS file drop (text/uri-list)
    const uriListItem = dataTransfer.get('text/uri-list');
    if (uriListItem && target) {
      if (target.nodeType === 'directory' || target.nodeType === 'server') {
        await this.handleOsFileDrop(target, String(uriListItem.value));
      }
      return;
    }

    const item = dataTransfer.get(DRAG_MIME);
    if (!item) return;
    const draggedIds = item.value as string[];
    if (!draggedIds || draggedIds.length === 0) return;
    if (target && target.nodeType !== 'server') return;

    const connections = this.connectionManager.getConnections();
    const currentIds = connections.map((c) => c.id);
    const remaining = currentIds.filter((id) => !draggedIds.includes(id));

    if (target) {
      const targetIdx = remaining.indexOf(target.connectionId);
      if (targetIdx === -1) {
        // target was itself dragged — append at end
        remaining.push(...draggedIds);
      } else {
        remaining.splice(targetIdx, 0, ...draggedIds);
      }
    } else {
      remaining.push(...draggedIds);
    }

    await this.connectionManager.reorderConnections(remaining);
  }

  getTreeItem(node: FtpTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, getCollapsibleState(node.nodeType));
    item.contextValue = getContextValue(node, this.connectionManager);
    item.iconPath = getIcon(node, this.connectionManager, this.extensionUri);
    item.id = this.getNodeId(node);
    item.description = node.description;

    if (node.nodeType === 'openedFiles') {
      item.id = 'opened-files';
      item.contextValue = 'openedFiles';
    }

    if (node.nodeType === 'recentFiles') {
      item.id = 'recent-files';
      item.contextValue = 'recentFiles';
    }

    if (node.nodeType === 'server') {
      const gen = this.disconnectGen.get(node.connectionId) ?? 0;
      item.id = `${node.connectionId}-${gen}`;
      item.resourceUri = vscode.Uri.parse(`ftpmanager-server://${node.connectionId}/`);
      const connected = this.connectionManager.isConnected(node.connectionId);
      item.description = connected ? runtimeT('Connected') : '';
    }

    if (node.nodeType === 'group') {
      item.id = `group:${node.group ?? node.label}`;
      item.contextValue = 'group';
    }

    if (
      node.nodeType === 'file' ||
      node.nodeType === 'directory' ||
      node.nodeType === 'openedFile' ||
      node.nodeType === 'recentFile'
    ) {
      item.resourceUri = vscode.Uri.parse(`ftpmanager-tree://${node.connectionId}${node.remotePath}`);
    }

    if ((node.nodeType === 'file' || node.nodeType === 'directory') && node.permissions) {
      item.description = `(${node.permissions})`;
    }

    if (node.nodeType === 'file' || node.nodeType === 'openedFile' || node.nodeType === 'recentFile') {
      item.command = {
        command: 'ftpmanager.openRemoteFile',
        title: 'Open Remote File',
        arguments: [node],
      };
    }

    return item;
  }

  getParent(node: FtpTreeNode): FtpTreeNode | undefined {
    if (node.nodeType === 'openedFiles') return undefined;

    if (node.nodeType === 'openedFile') return undefined;

    if (node.nodeType === 'recentFiles') return undefined;

    if (node.nodeType === 'recentFile') {
      return {
        nodeType: 'recentFiles',
        label: runtimeT('Recent Files'),
        connectionId: '',
        remotePath: '',
      };
    }

    if (node.nodeType === 'group') return undefined;

    if (node.nodeType === 'server') {
      const config = this.connectionManager.getConnection(node.connectionId);
      const group = config?.group?.trim();
      return group
        ? {
          nodeType: 'group',
          label: group,
          group,
          connectionId: '',
          remotePath: '',
        }
        : undefined;
    }

    const config = this.connectionManager.getConnection(node.connectionId);
    const rootPath = this.normalizePath(config?.remotePath || '/');
    const currentPath = this.normalizePath(node.remotePath);

    if (currentPath === rootPath || currentPath === '/') {
      return config
        ? {
          nodeType: 'server',
          label: config.name,
          connectionId: config.id,
          remotePath: config.remotePath || '/',
        }
        : undefined;
    }

    const parentPath = this.normalizePath(path.posix.dirname(currentPath));
    if (parentPath === rootPath || parentPath === '/') {
      return config
        ? {
          nodeType: 'server',
          label: config.name,
          connectionId: config.id,
          remotePath: config.remotePath || '/',
        }
        : undefined;
    }

    return {
      nodeType: 'directory',
      label: path.posix.basename(parentPath),
      connectionId: node.connectionId,
      remotePath: parentPath,
    };
  }

  async getChildren(node?: FtpTreeNode): Promise<FtpTreeNode[]> {
    if (!node) {
      return this.getRootNodes();
    }
    switch (node.nodeType) {
      case 'recentFiles':
        return this.getRecentFileChildren();
      case 'group':
        return this.getGroupChildren(node);
      case 'server':
        return this.getServerChildren(node);
      case 'directory':
        return this.getDirectoryChildren(node);
      default:
        return [];
    }
  }

  private getRootNodes(): FtpTreeNode[] {
    const connections = this.connectionManager.getConnections();
    const openedFileNodes: FtpTreeNode[] = this.shouldShowOpenedFiles() && this.getOpenRemoteFileUris().length > 0
      ? [
        {
        nodeType: 'openedFiles',
        label: runtimeT('Opened Files'),
        connectionId: '',
        remotePath: '',
        },
        ...this.getOpenedFileChildren(),
      ]
      : [];
    const recentFileChildren = this.shouldShowOpenedFiles() ? this.getRecentFileChildren() : [];
    const recentFileNodes: FtpTreeNode[] = recentFileChildren.length > 0
      ? [{
        nodeType: 'recentFiles',
        label: runtimeT('Recent Files'),
        connectionId: '',
        remotePath: '',
      }]
      : [];
    const groups = [...new Set(
      connections
        .map((cfg) => cfg.group?.trim())
        .filter((group): group is string => Boolean(group)),
    )].sort((a, b) => a.localeCompare(b));

    const groupNodes = groups.map((group): FtpTreeNode => ({
      nodeType: 'group',
      label: group,
      group,
      connectionId: '',
      remotePath: '',
    }));

    const ungrouped = connections
      .filter((cfg) => !cfg.group?.trim())
      .map((cfg): FtpTreeNode => ({
        nodeType: 'server',
        label: cfg.name,
        connectionId: cfg.id,
        remotePath: cfg.remotePath,
      }));

    return [...openedFileNodes, ...recentFileNodes, ...groupNodes, ...ungrouped];
  }

  private getNodeId(node: FtpTreeNode): string {
    if (node.nodeType === 'openedFiles') return 'opened-files';
    if (node.nodeType === 'recentFiles') return 'recent-files';
    return `${node.connectionId}:${node.nodeType}:${this.normalizePath(node.remotePath)}`;
  }

  private normalizePath(remotePath: string): string {
    return (remotePath || '/').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  }

  private getGroupChildren(node: FtpTreeNode): FtpTreeNode[] {
    const group = node.group ?? node.label;
    return this.connectionManager.getConnections()
      .filter((cfg) => cfg.group?.trim() === group)
      .map((cfg): FtpTreeNode => ({
        nodeType: 'server',
        label: cfg.name,
        connectionId: cfg.id,
        remotePath: cfg.remotePath,
        group,
      }));
  }

  private getOpenedFileChildren(): FtpTreeNode[] {
    return this.uriStringsToFileNodes(this.getOpenRemoteFileUris(), 'openedFile');
  }

  private getRecentFileChildren(): FtpTreeNode[] {
    const openUris = new Set(this.getOpenRemoteFileUris());
    return this.uriStringsToFileNodes(
      this.getRecentRemoteFileUris().filter((uriString) => !openUris.has(uriString)),
      'recentFile',
    );
  }

  private uriStringsToFileNodes(uriStrings: string[], nodeType: 'openedFile' | 'recentFile'): FtpTreeNode[] {
    return uriStrings
      .map((uriString): FtpTreeNode | undefined => {
        try {
          const uri = vscode.Uri.parse(uriString);
          if (uri.scheme !== 'ftpmanager' || !uri.authority) return undefined;
          const connection = this.connectionManager.getConnection(uri.authority);
          const serverName = connection?.name ?? uri.authority;
          return {
            nodeType,
            label: path.posix.basename(uri.path),
            connectionId: uri.authority,
            remotePath: uri.path,
            description: `${serverName}${uri.path}`,
          };
        } catch {
          return undefined;
        }
      })
      .filter((node): node is FtpTreeNode => Boolean(node));
  }

  private async getServerChildren(node: FtpTreeNode): Promise<FtpTreeNode[]> {
    const config = this.connectionManager.getConnection(node.connectionId);
    if (!config) return [];

    if (this.connectingIds.has(node.connectionId)) return [];

    const alreadyConnected = this.connectionManager.isConnected(node.connectionId);
    if (alreadyConnected) {
      const client = this.connectionManager.getClient(node.connectionId);
      const effectivePath = config.remotePath || await this.resolvePwd(client) || '/';
      return this.listWithFallback(node.connectionId, effectivePath, config.name);
    }

    this.connectingIds.add(node.connectionId);
    const controller = new AbortController();
    let cancelled = false;
    let result: FtpTreeNode[] = [];

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Connecting to "{0}"...', config.name),
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => {
            cancelled = true;
            controller.abort();
          });

          await this.connectionManager.connect(
            node.connectionId,
            controller.signal,
            (attempt, maxAttempts, delayMs) => {
              progress.report({
                message: vscode.l10n.t(
                  'Retry {0}/{1} — waiting {2}s (too many connections)...',
                  attempt, maxAttempts, delayMs / 1000,
                ),
              });
            },
          );

          if (controller.signal.aborted) return;

          progress.report({ message: vscode.l10n.t('Loading directory...') });

          const client = this.connectionManager.getClient(node.connectionId);
          const effectivePath = config.remotePath || await this.resolvePwd(client) || '/';
          result = await this.listWithTimeout(node.connectionId, effectivePath, config.name, controller.signal);
        },
      );
    } catch (err) {
      if (!cancelled) {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to connect "{0}": {1}', config.name, err instanceof Error ? err.message : String(err)),
        );
      }
      return [];
    } finally {
      this.connectingIds.delete(node.connectionId);
    }

    return result;
  }

  private async resolvePwd(client: import('../services/ftp-client.js').IFtpClient | undefined): Promise<string> {
    if (!client) return '/';
    try { return await withTimeout(client.pwd(), 10_000); } catch { return '/'; }
  }

  private async listWithTimeout(
    connectionId: string,
    remotePath: string,
    serverName: string,
    signal: AbortSignal,
  ): Promise<FtpTreeNode[]> {
    if (signal.aborted) return [];
    return this.listWithFallback(connectionId, remotePath, serverName);
  }

  private async listWithFallback(
    connectionId: string,
    remotePath: string,
    serverName: string,
  ): Promise<FtpTreeNode[]> {
    try {
      const entries = await this.listRemoteEntries(connectionId, remotePath);
      return this.mapEntries(entries, connectionId, remotePath);
    } catch (err) {
      if (remotePath !== '/') {
        // Configured path failed — try root as fallback
        try {
          const rootEntries = await this.listRemoteEntries(connectionId, '/');
          vscode.window.showWarningMessage(
            vscode.l10n.t('Path "{0}" is unavailable for {1}. Showing root directory.', remotePath, serverName),
          );
          return this.mapEntries(rootEntries, connectionId, '/');
        } catch (rootErr) {
          vscode.window.showErrorMessage(
            vscode.l10n.t('Failed to load directory: {0}', rootErr instanceof Error ? rootErr.message : String(rootErr)),
          );
          return [];
        }
      }
      // Root path failed — show error so user knows something went wrong
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to load directory: {0}', err instanceof Error ? err.message : String(err)),
      );
      return [];
    }
  }

  private async listRemoteEntries(
    connectionId: string,
    remotePath: string,
  ): Promise<import('@ftpmanager/shared').RemoteFileEntry[]> {
    let client = this.connectionManager.getClient(connectionId);

    if (!client && this.connectionManager.isConnected(connectionId)) {
      await this.connectionManager.reconnect(connectionId);
      client = this.connectionManager.getClient(connectionId);
    }

    if (!client) return [];

    try {
      return await withTimeout(client.list(remotePath), 35_000);
    } catch (err) {
      if (!isClosedConnectionError(err)) throw err;
      await this.connectionManager.reconnect(connectionId);
      client = this.connectionManager.getClient(connectionId);
      if (!client) return [];
      return withTimeout(client.list(remotePath), 35_000);
    }
  }

  private mapEntries(
    entries: import('@ftpmanager/shared').RemoteFileEntry[],
    connectionId: string,
    remotePath: string,
  ): FtpTreeNode[] {
    return entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      })
      .map((entry): FtpTreeNode => ({
        nodeType: entry.type === 'directory' ? 'directory' : 'file',
        label: entry.name,
        connectionId,
        remotePath: remotePath.endsWith('/') ? remotePath + entry.name : remotePath + '/' + entry.name,
        permissions: entry.permissions,
      }));
  }

  private async getDirectoryChildren(node: FtpTreeNode): Promise<FtpTreeNode[]> {
    return this.listDirectory(node.connectionId, node.remotePath);
  }

  private async listDirectory(connectionId: string, remotePath: string): Promise<FtpTreeNode[]> {
    try {
      const entries = await this.listRemoteEntries(connectionId, remotePath);
      return this.mapEntries(entries, connectionId, remotePath);
    } catch (err) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to load directory: {0}', err instanceof Error ? err.message : String(err)),
      );
      return [];
    }
  }

  private async handleOsFileDrop(target: FtpTreeNode, uriList: string): Promise<void> {
    // Parse URI list: split by newlines, filter comments/empty, get fsPath
    const localPaths = uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'))
      .map((line) => vscode.Uri.parse(line).fsPath);

    if (localPaths.length === 0) return;

    const client = this.connectionManager.getClient(target.connectionId);
    if (!client) {
      vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
      return;
    }

    const uploadDir = target.remotePath;
    const total = localPaths.length;

    const defaultPermissions = this.connectionManager.getConnection(target.connectionId)?.defaultFilePermissions ?? '644';
    const perms = await pickPermissions({
      title: vscode.l10n.t('Select uploaded file permissions'),
      defaultPermissions,
      defaultLabel: vscode.l10n.t('Server default'),
    });

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Uploading {0} file(s)...', total),
        cancellable: false,
      },
      async (progress) => {
        for (let i = 0; i < localPaths.length; i++) {
          const localPath = localPaths[i];
          const fileName = path.basename(localPath);
          progress.report({ message: `${i + 1}/${total}: ${fileName}` });
          const remoteDest = uploadDir.endsWith('/') ? uploadDir + fileName : uploadDir + '/' + fileName;
          await client.uploadFile(localPath, remoteDest);
          if (perms) {
            await client.chmod(remoteDest, perms).catch(() => {});
          }
        }
      },
    );

    this._onDidChangeTreeData.fire(target);
    vscode.window.showInformationMessage(
      vscode.l10n.t('Uploaded {0} file(s) to {1}', total, uploadDir),
    );
  }
}
