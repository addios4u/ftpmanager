import * as vscode from 'vscode';
import * as path from 'path';
import { ConnectionManager } from './services/connection-manager.js';
import { FtpTreeProvider } from './providers/ftp-tree.js';
import { WebviewPanelManager } from './webview/panel-manager.js';
import { FtpFileSystemProvider } from './providers/ftp-fs-provider.js';
import { COMMAND_IDS, VIEW_IDS } from '@ftpmanager/shared';

let connectionManager: ConnectionManager;
let treeProvider: FtpTreeProvider;
let panelManager: WebviewPanelManager;
let fsProvider: FtpFileSystemProvider;

export function activate(context: vscode.ExtensionContext): void {
  connectionManager = new ConnectionManager(context);
  treeProvider = new FtpTreeProvider(connectionManager, context.extensionUri);
  panelManager = new WebviewPanelManager(context, connectionManager);
  fsProvider = new FtpFileSystemProvider(connectionManager);

  // Register TreeView
  const treeView = vscode.window.createTreeView(VIEW_IDS.SERVERS, {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
    dragAndDropController: treeProvider,
  });
  context.subscriptions.push(treeView);

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

    vscode.commands.registerCommand(COMMAND_IDS.EDIT_SERVER, (node) => {
      panelManager.openConnectionDialog((node as { connectionId: string }).connectionId);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DELETE_SERVER, async (node) => {
      const n = node as { connectionId: string; label: string };
      const confirm = await vscode.window.showWarningMessage(
        vscode.l10n.t('Delete server "{0}"?', n.label),
        { modal: true },
        vscode.l10n.t('Delete'),
      );
      if (confirm === vscode.l10n.t('Delete')) {
        await connectionManager.deleteConnection(n.connectionId);
        treeProvider.refresh();
      }
    }),

    vscode.commands.registerCommand(COMMAND_IDS.CONNECT, (node) => {
      void connectionManager
        .connect((node as { connectionId: string }).connectionId)
        .then(() => treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]));
    }),

    vscode.commands.registerCommand(COMMAND_IDS.DISCONNECT, async (node) => {
      await connectionManager.disconnect((node as { connectionId: string }).connectionId);
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.REFRESH, (node?: unknown) => {
      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),

    vscode.commands.registerCommand(COMMAND_IDS.OPEN_REMOTE_FILE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; label: string };
      const uri = vscode.Uri.parse(
        `ftpmanager://${n.connectionId}${n.remotePath}`,
      );
      await vscode.commands.executeCommand('vscode.open', uri);
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

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${fileName}`,
          cancellable: false,
        },
        async () => {
          await client.uploadFile(uri.fsPath, remoteDest);
        },
      );
      vscode.window.showInformationMessage(`Uploaded to ${server.name}: ${remoteDest}`);
      treeProvider.refresh();
    }),
  );
}

export function deactivate(): void {
  connectionManager?.dispose();
  panelManager?.dispose();
}
