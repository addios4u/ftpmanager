import * as vscode from 'vscode';
import type { ConnectionManager } from '../services/connection-manager.js';

export type FtpNodeType = 'server' | 'directory' | 'file';

export interface FtpTreeNode {
  nodeType: FtpNodeType;
  label: string;
  connectionId: string;
  remotePath: string;
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
    case 'server':
    case 'directory':
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
  readonly dropMimeTypes = [DRAG_MIME];
  readonly dragMimeTypes = [DRAG_MIME];

  private readonly _onDidChangeTreeData = new vscode.EventEmitter<FtpTreeNode | undefined | null>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly connectingIds = new Set<string>();
  private readonly disconnectGen = new Map<string, number>();

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri,
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

    if (node.nodeType === 'server') {
      const gen = this.disconnectGen.get(node.connectionId) ?? 0;
      item.id = `${node.connectionId}-${gen}`;
      const connected = this.connectionManager.isConnected(node.connectionId);
      item.description = connected ? vscode.l10n.t('Connected') : '';
    }

    if (node.nodeType === 'file') {
      item.command = {
        command: 'ftpmanager.openRemoteFile',
        title: 'Open Remote File',
        arguments: [node],
      };
    }

    return item;
  }

  async getChildren(node?: FtpTreeNode): Promise<FtpTreeNode[]> {
    if (!node) {
      return this.getRootNodes();
    }
    switch (node.nodeType) {
      case 'server':
        return this.getServerChildren(node);
      case 'directory':
        return this.getDirectoryChildren(node);
      default:
        return [];
    }
  }

  private getRootNodes(): FtpTreeNode[] {
    return this.connectionManager.getConnections().map((cfg): FtpTreeNode => ({
      nodeType: 'server',
      label: cfg.name,
      connectionId: cfg.id,
      remotePath: cfg.remotePath,
    }));
  }

  private async getServerChildren(node: FtpTreeNode): Promise<FtpTreeNode[]> {
    const config = this.connectionManager.getConnection(node.connectionId);
    if (!config) return [];

    if (!this.connectionManager.isConnected(node.connectionId)) {
      if (this.connectingIds.has(node.connectionId)) return [];
      this.connectingIds.add(node.connectionId);
      const controller = new AbortController();
      let cancelled = false;
      try {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: vscode.l10n.t('Connecting to "{0}"...', config.name),
            cancellable: true,
          },
          async (_progress, token) => {
            token.onCancellationRequested(() => {
              cancelled = true;
              controller.abort();
            });
            await this.connectionManager.connect(node.connectionId, controller.signal);
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
    }

    // Try configured remotePath; fall back to root if it fails (e.g. 503 / path not found)
    return this.listWithFallback(node.connectionId, config.remotePath, config.name);
  }

  private async listWithFallback(
    connectionId: string,
    remotePath: string,
    serverName: string,
  ): Promise<FtpTreeNode[]> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) return [];

    try {
      const entries = await client.list(remotePath);
      return this.mapEntries(entries, connectionId, remotePath);
    } catch {
      if (remotePath === '/') return [];

      // Configured path failed — try root as fallback
      try {
        const rootEntries = await client.list('/');
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
      }));
  }

  private async getDirectoryChildren(node: FtpTreeNode): Promise<FtpTreeNode[]> {
    return this.listDirectory(node.connectionId, node.remotePath);
  }

  private async listDirectory(connectionId: string, remotePath: string): Promise<FtpTreeNode[]> {
    const client = this.connectionManager.getClient(connectionId);
    if (!client) return [];

    try {
      const entries = await client.list(remotePath);
      return this.mapEntries(entries, connectionId, remotePath);
    } catch (err) {
      vscode.window.showErrorMessage(
        vscode.l10n.t('Failed to load directory: {0}', err instanceof Error ? err.message : String(err)),
      );
      return [];
    }
  }
}
