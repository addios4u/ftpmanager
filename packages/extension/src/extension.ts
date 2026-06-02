import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './services/connection-manager.js';
import { FtpTreeProvider, type FtpTreeNode } from './providers/ftp-tree.js';
import { WebviewPanelManager } from './webview/panel-manager.js';
import { FtpFileSystemProvider } from './providers/ftp-fs-provider.js';
import { COMMAND_IDS, VIEW_IDS } from '@ftpmanager/shared';
import { searchByName, searchByContent } from './services/search-service.js';
import type { SearchResult } from './services/search-service.js';
import { pickRemoteFolder } from './services/folder-picker.js';
import * as os from 'os';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { getUniqueCopyName } from './utils/duplicate.js';
import { collectPermissions } from './utils/permissions.js';
import { pickPermissions } from './utils/pick-permissions.js';

let connectionManager: ConnectionManager;
let treeProvider: FtpTreeProvider;
let panelManager: WebviewPanelManager;
let fsProvider: FtpFileSystemProvider;
let ftpStatusBarItem: vscode.StatusBarItem | undefined;

const OPEN_REMOTE_FILES_KEY = 'ftpmanager.openRemoteFiles';

async function pickServer(
  connectionManager: ConnectionManager,
  title: string,
): Promise<string | undefined> {
  const connections = connectionManager.getConnections();
  if (connections.length === 0) {
    vscode.window.showWarningMessage(vscode.l10n.t('No servers configured.'));
    return undefined;
  }
  if (connections.length === 1) return connections[0].id;
  const picked = await vscode.window.showQuickPick(
    connections.map((c) => ({
      label: c.name,
      description: `${c.protocol}://${c.host}:${c.port}`,
      id: c.id,
    })),
    { title },
  );
  return picked?.id;
}

async function closeConnectionTabs(connectionId: string): Promise<void> {
  const tabsToClose: vscode.Tab[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.scheme === 'ftpmanager' &&
        tab.input.uri.authority === connectionId
      ) {
        tabsToClose.push(tab);
      }
    }
  }
  if (tabsToClose.length > 0) {
    await vscode.window.tabGroups.close(tabsToClose);
  }
}

function getOpenRemoteFileUris(): string[] {
  const uris: string[] = [];
  for (const tabGroup of vscode.window.tabGroups.all) {
    for (const tab of tabGroup.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'ftpmanager') {
        uris.push(tab.input.uri.toString());
      }
    }
  }
  return [...new Set(uris)];
}

function getRemoteUriFromTreeUri(uri: vscode.Uri): vscode.Uri {
  return vscode.Uri.parse(`ftpmanager://${uri.authority}${uri.path}`);
}

function isDirtyRemoteDocument(uri: vscode.Uri): boolean {
  return vscode.workspace.textDocuments.some((document) => (
    document.uri.scheme === 'ftpmanager' &&
    document.uri.toString() === uri.toString() &&
    document.isDirty
  ));
}

async function rememberOpenRemoteFiles(context: vscode.ExtensionContext): Promise<void> {
  await context.workspaceState.update(OPEN_REMOTE_FILES_KEY, getOpenRemoteFileUris());
}

function getServerNode(connectionId: string): FtpTreeNode | undefined {
  const connection = connectionManager.getConnection(connectionId);
  return connection
    ? {
      nodeType: 'server',
      label: connection.name,
      connectionId,
      remotePath: connection.remotePath,
    }
    : undefined;
}

function normalizeRemotePath(remotePath: string): string {
  return (remotePath || '/').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '') || '/';
}

function getRelativeRemoteSegments(remotePath: string, rootPath: string): string[] {
  const normalizedPath = normalizeRemotePath(remotePath);
  const normalizedRoot = normalizeRemotePath(rootPath);
  if (
    normalizedRoot !== '/' &&
    (normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`))
  ) {
    return normalizedPath.slice(normalizedRoot.length).split('/').filter(Boolean);
  }
  return normalizedPath.split('/').filter(Boolean);
}

async function revealRestoredFiles(
  treeView: vscode.TreeView<FtpTreeNode>,
  connectionId: string,
  uriStrings: string[],
): Promise<void> {
  try {
    await vscode.commands.executeCommand('workbench.view.explorer');
    await vscode.commands.executeCommand('ftpmanager.servers.focus');
    const serverNode = getServerNode(connectionId);
    if (!serverNode) return;

    treeProvider.refresh(serverNode);
    await new Promise((resolve) => setTimeout(resolve, 750));
    await Promise.resolve(treeView.reveal(serverNode, { select: false, focus: false, expand: true })).catch(() => {});

    const connection = connectionManager.getConnection(connectionId);
    const rootPath = connection?.remotePath || '/';

    for (const uriString of uriStrings) {
      let remotePath: string;
      try {
        remotePath = vscode.Uri.parse(uriString).path;
      } catch {
        continue;
      }

      const segments = getRelativeRemoteSegments(remotePath, rootPath);
      let currentPath = normalizeRemotePath(rootPath);

      if (segments.length > 1) {
        for (let index = 0; index < segments.length - 1; index++) {
          currentPath = currentPath === '/' ? `/${segments[index]}` : `${currentPath}/${segments[index]}`;
          const directoryNode: FtpTreeNode = {
            nodeType: 'directory',
            label: segments[index],
            connectionId,
            remotePath: currentPath,
          };
          await Promise.resolve(
            treeView.reveal(directoryNode, { select: false, focus: false, expand: true }),
          ).catch(() => {});
        }
      }

      const fileName = segments[segments.length - 1] || path.posix.basename(remotePath);
      const fileNode: FtpTreeNode = {
        nodeType: 'file',
        label: fileName,
        connectionId,
        remotePath,
      };
      await Promise.resolve(treeView.reveal(fileNode, { select: true, focus: false, expand: false })).catch(() => {});
    }
  } catch {
    // Best effort reveal only.
  }
}

async function reopenRestoredFiles(context: vscode.ExtensionContext, connectionId: string): Promise<void> {
  const savedUris = context.workspaceState.get<string[]>(OPEN_REMOTE_FILES_KEY, []);
  const openUris = new Set(getOpenRemoteFileUris());

  for (const uriString of savedUris) {
    try {
      const uri = vscode.Uri.parse(uriString);
      if (uri.scheme === 'ftpmanager' && uri.authority === connectionId && !openUris.has(uriString)) {
        await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
      }
    } catch {
      // Ignore invalid saved URIs.
    }
  }
}

function restoreRemoteFiles(
  context: vscode.ExtensionContext,
  treeView: vscode.TreeView<FtpTreeNode>,
): void {
  const restoreUris = context.workspaceState.get<string[]>(OPEN_REMOTE_FILES_KEY, []).filter((uriString, index, all) => {
    try {
      const uri = vscode.Uri.parse(uriString);
      return uri.scheme === 'ftpmanager' && uri.authority && all.indexOf(uriString) === index;
    } catch {
      return false;
    }
  });

  const connectionIds = restoreUris
    .map((uriString) => vscode.Uri.parse(uriString).authority)
    .filter((connectionId, index, all) => all.indexOf(connectionId) === index);

  if (connectionIds.length > 0) {
    setTimeout(() => {
      void Promise.resolve(vscode.commands.executeCommand('workbench.view.explorer'))
        .then(() => vscode.commands.executeCommand('ftpmanager.servers.focus'))
        .then(() => undefined)
        .catch(() => {});
    }, 750);
  }

  for (const connectionId of connectionIds) {
    void connectionManager.connect(connectionId)
      .then(async () => {
        const urisForConnection = restoreUris.filter((uriString) => {
          try {
            return vscode.Uri.parse(uriString).authority === connectionId;
          } catch {
            return false;
          }
        });
        await revealRestoredFiles(treeView, connectionId, urisForConnection);
        await reopenRestoredFiles(context, connectionId);
      })
      .catch((err) => {
        const connection = connectionManager.getConnection(connectionId);
        const connectionName = connection?.name ?? connectionId;
        vscode.window.showWarningMessage(
          vscode.l10n.t(
            'Could not restore FTP session "{0}": {1}',
            connectionName,
            err instanceof Error ? err.message : String(err),
          ),
        );
      });
  }
}

export function activate(context: vscode.ExtensionContext): void {
  connectionManager = new ConnectionManager(context);
  treeProvider = new FtpTreeProvider(connectionManager, context.extensionUri);
  panelManager = new WebviewPanelManager(context, connectionManager);
  ftpStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  ftpStatusBarItem.name = 'FTP Manager';
  context.subscriptions.push(ftpStatusBarItem);

  fsProvider = new FtpFileSystemProvider(connectionManager, ftpStatusBarItem);

  // Register TreeView
  const treeView = vscode.window.createTreeView(VIEW_IDS.SERVERS, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    dragAndDropController: treeProvider,
  });
  context.subscriptions.push(treeView);
  const ftpServerDecorationEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  context.subscriptions.push(ftpServerDecorationEmitter);
  context.subscriptions.push(
    vscode.window.registerFileDecorationProvider({
      onDidChangeFileDecorations: ftpServerDecorationEmitter.event,
      provideFileDecoration: (uri) => {
        if (uri.scheme === 'ftpmanager-server' && connectionManager.isConnected(uri.authority)) {
          return {
            color: new vscode.ThemeColor('terminal.ansiGreen'),
            tooltip: vscode.l10n.t('Connected'),
          };
        }

        if (uri.scheme === 'ftpmanager-tree' && getOpenRemoteFileUris().includes(getRemoteUriFromTreeUri(uri).toString())) {
          return {
            color: new vscode.ThemeColor('terminal.ansiCyan'),
            tooltip: vscode.l10n.t('Open remote file'),
          };
        }

        if (uri.scheme === 'ftpmanager' && isDirtyRemoteDocument(uri)) {
          return {
            color: new vscode.ThemeColor('terminal.ansiRed'),
            tooltip: vscode.l10n.t('Unsaved remote changes'),
          };
        }

        return undefined;
      },
    }),
  );
  context.subscriptions.push(
    connectionManager.onDidChangeConnectionState(({ connectionId }) => {
      ftpServerDecorationEmitter.fire(vscode.Uri.parse(`ftpmanager-server://${connectionId}/`));
    }),
  );
  context.subscriptions.push(vscode.window.tabGroups.onDidChangeTabs(() => {
    void rememberOpenRemoteFiles(context);
    ftpServerDecorationEmitter.fire(undefined);
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document.uri.scheme === 'ftpmanager') {
      ftpServerDecorationEmitter.fire(event.document.uri);
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument((document) => {
    if (document.uri.scheme === 'ftpmanager') {
      ftpServerDecorationEmitter.fire(document.uri);
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidCloseTextDocument((document) => {
    if (document.uri.scheme === 'ftpmanager') {
      ftpServerDecorationEmitter.fire(document.uri);
      ftpServerDecorationEmitter.fire(vscode.Uri.parse(`ftpmanager-tree://${document.uri.authority}${document.uri.path}`));
    }
  }));
  void rememberOpenRemoteFiles(context);

  // Register virtual filesystem for remote file editing (ftpmanager://)
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider('ftpmanager', fsProvider, {
      isCaseSensitive: true,
    }),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_IDS.ADD_SERVER, () => {
      panelManager.openConnectionDialog();
    }),

    vscode.commands.registerCommand(COMMAND_IDS.EDIT_SERVER, async (node) => {
      const id = node
        ? (node as { connectionId: string }).connectionId
        : await pickServer(connectionManager, vscode.l10n.t('Select server to edit'));
      if (id) panelManager.openConnectionDialog(id);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DELETE_SERVER, async (node) => {
      const id = node
        ? (node as { connectionId: string; label: string }).connectionId
        : await pickServer(connectionManager, vscode.l10n.t('Select server to delete'));
      if (!id) return;
      const cfg = connectionManager.getConnection(id);
      if (!cfg) return;
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete server "{0}"?', cfg.name),
        { modal: true },
        vscode.l10n.t('Delete'),
      );
      if (confirm === vscode.l10n.t('Delete')) {
        await connectionManager.deleteConnection(id);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand(COMMAND_IDS.CONNECT, async (node) => {
      const id = node
        ? (node as { connectionId: string }).connectionId
        : await pickServer(connectionManager, vscode.l10n.t('Select server to connect'));
      if (!id) return;
      void connectionManager.connect(id).then(async () => {
        treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
        await reopenRestoredFiles(context, id);
      });
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DISCONNECT, async (node) => {
      const id = node
        ? (node as { connectionId: string }).connectionId
        : await pickServer(connectionManager, vscode.l10n.t('Select server to disconnect'));
      if (!id) return;
      await connectionManager.disconnect(id);
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
      await closeConnectionTabs(id);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.REFRESH, (node?: unknown) => {
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.OPEN_REMOTE_FILE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string };
      const uri = vscode.Uri.parse(
        `ftpmanager://${n.connectionId}${n.remotePath}`,
      );
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    }),

    vscode.commands.registerCommand(COMMAND_IDS.UPLOAD_FILE, async (node) => {
      const n = node as { connectionId: string; remotePath: string };
      const files = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: true,
        openLabel: vscode.l10n.t('Upload File'),
      });
      if (!files || files.length === 0) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const perms = await pickPermissions();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Upload File'),
          cancellable: false,
        },
        async (progress) => {
          for (const file of files) {
            const fileName = path.basename(file.fsPath);
            progress.report({ message: fileName });
            const remoteDest = n.remotePath.endsWith('/')
              ? n.remotePath + fileName
              : n.remotePath + '/' + fileName;
            await client.uploadFile(file.fsPath, remoteDest);
            if (perms) {
              await client.chmod(remoteDest, perms).catch(() => {});
            }
          }
        },
      );
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DOWNLOAD_FILE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string };
      const dest = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(n.label),
        saveLabel: vscode.l10n.t('Download'),
      });
      if (!dest) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Download'),
          cancellable: false,
        },
        async () => {
          await client.downloadFile(n.remotePath, dest.fsPath);
        },
      );
      vscode.window.showInformationMessage(`Downloaded: ${dest.fsPath}`);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DOWNLOAD_FOLDER, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string };
      const dest = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: vscode.l10n.t('Download Folder Here'),
      });
      if (!dest || dest.length === 0) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const localDest = dest[0].fsPath + '/' + n.label;
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Download'),
          cancellable: false,
        },
        async (progress) => {
          progress.report({ message: n.remotePath });
          await client.downloadFolder(n.remotePath, localDest);
        },
      );
      vscode.window.showInformationMessage(`Downloaded to: ${localDest}`);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.NEW_FOLDER, async (node) => {
      const n = node as { connectionId: string; remotePath: string };
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New Folder'),
        prompt: vscode.l10n.t('Enter folder name'),
        placeHolder: vscode.l10n.t('Folder name'),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : 'Name is required'),
      });
      if (!name) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const newPath = n.remotePath.endsWith('/')
        ? n.remotePath + name
        : n.remotePath + '/' + name;
      await client.mkdir(newPath);
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.NEW_FILE, async (node) => {
      const n = node as { connectionId: string; remotePath: string };
      const name = await vscode.window.showInputBox({
        title: vscode.l10n.t('New File'),
        prompt: vscode.l10n.t('Enter file name'),
        placeHolder: vscode.l10n.t('File name'),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : 'Name is required'),
      });
      if (!name) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const perms = await pickPermissions();

      const newPath = n.remotePath.endsWith('/')
        ? n.remotePath + name
        : n.remotePath + '/' + name;
      await client.putContent(Buffer.alloc(0), newPath);
      if (perms) {
        await client.chmod(newPath, perms).catch(() => {});
      }

      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);

      const uri = vscode.Uri.parse(`ftpmanager://${n.connectionId}${newPath}`);
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    }),

    vscode.commands.registerCommand(COMMAND_IDS.RENAME, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string };
      const newName = await vscode.window.showInputBox({
        title: vscode.l10n.t('Rename'),
        prompt: vscode.l10n.t('Enter new name'),
        value: n.label,
        placeHolder: vscode.l10n.t('New name'),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : 'Name is required'),
      });
      if (!newName || newName === n.label) return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const dir = n.remotePath.substring(0, n.remotePath.lastIndexOf('/'));
      const newPath = dir + '/' + newName;
      await client.rename(n.remotePath, newPath);
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DELETE_REMOTE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string; nodeType: string };
      const confirm = await vscode.window.showWarningMessage(
        `Delete "${n.label}"? This cannot be undone.`,
        { modal: true },
        'Delete',
      );
      if (confirm !== 'Delete') return;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      if (n.nodeType === 'directory') {
        await client.rmdir(n.remotePath, true);
      } else {
        await client.delete(n.remotePath);
      }
      treeProvider.refresh();
    }),

    vscode.commands.registerCommand(COMMAND_IDS.COPY_REMOTE_PATH, (node) => {
      const n = node as { remotePath: string };
      void vscode.env.clipboard.writeText(n.remotePath);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DUPLICATE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; nodeType: string; label: string };
      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const parentDir = n.remotePath.substring(0, n.remotePath.lastIndexOf('/')) || '/';
      const baseName = n.remotePath.substring(n.remotePath.lastIndexOf('/') + 1);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Duplicating: {0}', baseName),
          cancellable: false,
        },
        async (progress) => {
          const tmpBase = path.join(os.tmpdir(), `ftpmanager-${randomUUID()}`);
          const tmpPath = path.join(tmpBase, baseName);
          let destPath = '';
          try {
            const entries = await client.list(parentDir);
            const sourceEntry = entries.find((e) => e.name === baseName);
            const existingNames = entries.map((e) => e.name);
            const newName = getUniqueCopyName(baseName, existingNames);
            destPath = parentDir === '/' ? `/${newName}` : `${parentDir}/${newName}`;

            await fs.mkdir(tmpBase, { recursive: true });

            if (n.nodeType === 'file') {
              await client.downloadFile(n.remotePath, tmpPath);
              await client.uploadFile(tmpPath, destPath);
              if (sourceEntry?.permissions) {
                await client.chmod(destPath, sourceEntry.permissions).catch(() => {});
              }
            } else {
              // 업로드 전에 원본 폴더의 퍼미션 맵 수집
              const permMap = await collectPermissions(client, n.remotePath).catch(() => new Map<string, string>());

              progress.report({ message: vscode.l10n.t('Downloading...') });
              await client.downloadFolder(n.remotePath, tmpPath);
              progress.report({ message: vscode.l10n.t('Uploading...') });
              await client.uploadFolder(tmpPath, destPath);

              // 수집된 퍼미션을 복사본에 재귀 적용
              for (const [relPath, perms] of permMap) {
                const target = relPath ? `${destPath}/${relPath}` : destPath;
                await client.chmod(target, perms).catch(() => {});
              }
            }

            vscode.window.showInformationMessage(vscode.l10n.t('Duplicated to: {0}', newName));
          } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to duplicate: {0}', String(err)));
            if (destPath) {
              try {
                if (n.nodeType === 'file') {
                  await client.delete(destPath);
                } else {
                  await client.rmdir(destPath, true);
                }
              } catch {
                // best-effort cleanup of partial remote destination
              }
            }
          } finally {
            await fs.rm(tmpBase, { recursive: true, force: true });
          }
        },
      );

      treeProvider.refresh();
    }),

    vscode.commands.registerCommand(COMMAND_IDS.CHMOD, async (node) => {
      const n = node as FtpTreeNode;

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const perms = await pickPermissions();
      if (!perms) return;

      let succeeded = false;
      await client.chmod(n.remotePath, perms).then(() => {
        succeeded = true;
      }).catch((err) => {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to change permissions: {0}', err instanceof Error ? err.message : String(err)),
        );
      });

      if (succeeded) {
        n.permissions = perms;
        vscode.window.showInformationMessage(
          vscode.l10n.t('Changed permissions of "{0}" to {1}', path.basename(n.remotePath), perms),
        );
      }

      treeProvider.refresh(n);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.SEARCH_FILES, async (node?: unknown) => {
      const n = node as FtpTreeNode | undefined;
      let connectionId = n?.connectionId;
      if (!connectionId) {
        connectionId = await pickServer(connectionManager, vscode.l10n.t('Select server to search'));
      }
      if (!connectionId) return;

      const client = connectionManager.getClient(connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection. Connect to a server first.'));
        return;
      }

      const config = connectionManager.getConnection(connectionId);
      if (!config) return;

      let rootPath: string;
      if (n?.nodeType === 'directory' && n?.remotePath) {
        // Triggered from directory context menu — skip folder picker
        rootPath = n.remotePath;
      } else {
        // Command palette or server node — show drill-down folder picker
        const picked = await pickRemoteFolder(client, connectionId, config.remotePath || '/');
        if (!picked) return;
        rootPath = picked;
      }

      const keyword = await vscode.window.showInputBox({
        title: vscode.l10n.t('Search Remote Files'),
        prompt: vscode.l10n.t('Enter keyword to search'),
        placeHolder: vscode.l10n.t('Search keyword'),
        ignoreFocusOut: true,
        validateInput: (v) => (v.trim() ? null : 'Keyword is required'),
      });
      if (!keyword) return;

      const searchMode = await vscode.window.showQuickPick(
        [
          { label: vscode.l10n.t('File name'), description: vscode.l10n.t('Search file names only (fast)'), value: 'name' as const },
          { label: vscode.l10n.t('File content'), description: vscode.l10n.t('Search inside files (slower, downloads files)'), value: 'content' as const },
        ],
        { title: vscode.l10n.t('Search Mode'), placeHolder: vscode.l10n.t('Select search mode') },
      );
      if (!searchMode) return;

      const controller = new AbortController();
      let results: SearchResult[] = [];

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Searching "{0}" on {1}...', keyword, config.name),
          cancellable: true,
        },
        async (progress, token) => {
          token.onCancellationRequested(() => controller.abort());

          if (searchMode.value === 'name') {
            results = await searchByName(client, connectionId!, rootPath, keyword, { signal: controller.signal }, (p) => {
              progress.report({ message: p });
            });
          } else {
            const allFiles = await searchByName(client, connectionId!, rootPath, '', { signal: controller.signal }, (p) => {
              progress.report({ message: vscode.l10n.t('Scanning: {0}', p) });
            });
            if (!controller.signal.aborted) {
              results = await searchByContent(client, connectionId!, allFiles, keyword, controller.signal, (p) => {
                progress.report({ message: vscode.l10n.t('Searching: {0}', p) });
              });
            }
          }
        },
      );

      if (results.length === 0) {
        vscode.window.showInformationMessage(vscode.l10n.t('No files found for "{0}"', keyword));
        return;
      }

      const picked = await vscode.window.showQuickPick(
        results.map((r) => ({
          label: r.fileName,
          description: r.remotePath,
          detail: r.matchType === 'content' ? `Line ${r.lineNumber}: ${r.lineContent}` : undefined,
          result: r,
        })),
        {
          title: vscode.l10n.t('Search Results ({0} found)', results.length),
          placeHolder: vscode.l10n.t('Select a file to open'),
          matchOnDescription: true,
          matchOnDetail: true,
        },
      );

      if (!picked) return;

      const uri = vscode.Uri.parse(`ftpmanager://${connectionId}${picked.result.remotePath}`);
      await vscode.commands.executeCommand('vscode.open', uri, { preview: false });
    }),

    vscode.commands.registerCommand(COMMAND_IDS.UPLOAD_TO_SERVER, async (uri?: vscode.Uri) => {
      if (!uri) return;
      const servers = connectionManager.getConnectionInfos().filter((c) => c.isConnected);
      if (servers.length === 0) {
        vscode.window.showWarningMessage('No connected FTP servers. Connect to a server first.');
        return;
      }

      let targetId: string;
      if (servers.length === 1) {
        targetId = servers[0].id;
      } else {
        const picked = await vscode.window.showQuickPick(
          servers.map((s) => ({ label: s.name, id: s.id })),
          { title: 'Select FTP Server', placeHolder: 'Choose a connected server' },
        );
        if (!picked) return;
        targetId = picked.id;
      }

      const server = servers.find((s) => s.id === targetId)!;
      const client = connectionManager.getClient(targetId);
      if (!client) return;

      const fileName = path.basename(uri.fsPath);
      const remoteDest = server.remotePath.endsWith('/')
        ? server.remotePath + fileName
        : server.remotePath + '/' + fileName;

      const perms = await pickPermissions();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${fileName}`,
          cancellable: false,
        },
        async () => {
          await client.uploadFile(uri.fsPath, remoteDest);
          if (perms) {
            await client.chmod(remoteDest, perms).catch(() => {});
          }
        },
      );
      vscode.window.showInformationMessage(`Uploaded to ${server.name}: ${remoteDest}`);
      treeProvider.refresh();
    }),
  );

  restoreRemoteFiles(context, treeView);
}

export function deactivate(): void {
  connectionManager?.dispose();
  panelManager?.dispose();
}
