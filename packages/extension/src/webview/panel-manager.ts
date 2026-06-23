import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PASSWORD_KEY_PREFIX, PASSPHRASE_KEY_PREFIX } from '@ftpmanager/shared';
import type { WebviewMessage } from '@ftpmanager/shared';
import type { FtpManagerLanguage, FtpManagerLanguageOption } from '@ftpmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import { FtpClient } from '../services/ftp-client.js';
import { SftpClient } from '../services/sftp-client.js';
import type { ExportedConnection } from '../services/connection-manager.js';

interface ConnectionsExportFile {
  format: 'ftpmanager.connections';
  version: 1;
  exportedAt: string;
  connections: ExportedConnection[];
}

const LANGUAGE_LABELS: Record<FtpManagerLanguage, string> = {
  auto: 'Auto',
  en: 'English',
  fr: 'Fran\u00e7ais',
  ja: '\u65e5\u672c\u8a9e',
  ko: '\ud55c\uad6d\uc5b4',
  'zh-cn': '\u7b80\u4f53\u4e2d\u6587',
};

export class WebviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private pendingEditId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
  ) {}

  private getViewLocation(): 'explorer' | 'activityBar' {
    const configured = vscode.workspace
      .getConfiguration('ftpmanager')
      .get<string>('viewLocation', 'explorer');
    return configured === 'activityBar' ? 'activityBar' : 'explorer';
  }

  private getLanguage(): FtpManagerLanguage {
    const configured = vscode.workspace
      .getConfiguration('ftpmanager')
      .get<string>('language', 'auto');
    return this.asSupportedLanguage(configured);
  }

  private asSupportedLanguage(language: string): FtpManagerLanguage {
    return language === 'en' ||
      language === 'fr' ||
      language === 'ja' ||
      language === 'ko' ||
      language === 'zh-cn'
      ? language
      : 'auto';
  }

  private getLanguageOptions(): FtpManagerLanguageOption[] {
    const detected = new Set<FtpManagerLanguage>(['auto', 'en']);
    const extensionPath = this.context.extensionUri.fsPath;

    // extensionUri.fsPath is not guaranteed readable on remote/virtual hosts;
    // never let a directory read crash the settings dialog state sync.
    let rootEntries: string[] = [];
    try {
      rootEntries = fs.readdirSync(extensionPath);
    } catch {
      rootEntries = [];
    }
    for (const fileName of rootEntries.filter((name) => name.startsWith('package.nls'))) {
      const match = /^package\.nls\.([^.]+)\.json$/i.exec(fileName);
      if (match) detected.add(this.asSupportedLanguage(match[1].toLowerCase()));
    }

    const l10nPath = path.join(extensionPath, 'l10n');
    if (fs.existsSync(l10nPath)) {
      for (const fileName of fs.readdirSync(l10nPath).filter((name) => name.startsWith('bundle.l10n'))) {
        const match = /^bundle\.l10n\.([^.]+)\.json$/i.exec(fileName);
        if (match) detected.add(this.asSupportedLanguage(match[1].toLowerCase()));
      }
    }

    return [...detected]
      .filter((language) => language !== 'auto' || detected.size > 1)
      .map((language) => ({
        value: language,
        label: LANGUAGE_LABELS[language],
      }));
  }

  private postStateSync(): void {
    this.panel?.webview.postMessage({
      type: 'stateSync',
      connections: this.connectionManager.getConnectionInfos(),
      viewLocation: this.getViewLocation(),
      language: this.getLanguage(),
      languageOptions: this.getLanguageOptions(),
      vscodeLanguage: vscode.env.language,
    });
  }

  openConnectionDialog(editId?: string): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postStateSync();
      if (editId) {
        this.panel.webview.postMessage({ type: 'openEdit', editId });
      }
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'ftpmanager.connectionDialog',
      'FTP Manager',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        ],
      },
    );

    this.pendingEditId = editId;
    this.panel.webview.html = this.getWebviewHtml(this.panel.webview);

    this.panel.webview.onDidReceiveMessage(
      async (msg: WebviewMessage) => {
        try {
          await this.handleMessage(msg);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          vscode.window.showErrorMessage(`FTPManager: ${message}`);
          this.panel?.webview.postMessage({ type: 'error', message });
        }
      },
      undefined,
      this.context.subscriptions,
    );

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.pendingEditId = undefined;
    });
  }

  private async handleMessage(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready': {
        this.postStateSync();
        if (this.pendingEditId) {
          this.panel?.webview.postMessage({ type: 'openEdit', editId: this.pendingEditId });
          this.pendingEditId = undefined;
        }
        break;
      }

      case 'saveConnection': {
        await this.connectionManager.saveConnection(msg.config, msg.password, msg.passphrase);
        this.postStateSync();
        break;
      }

      case 'deleteConnection': {
        await this.connectionManager.deleteConnection(msg.connectionId);
        this.postStateSync();
        break;
      }

      case 'exportConnections': {
        await this.exportConnections();
        break;
      }

      case 'importConnections': {
        await this.importConnections();
        break;
      }

      case 'updateViewLocation': {
        await vscode.workspace
          .getConfiguration('ftpmanager')
          .update('viewLocation', msg.viewLocation, vscode.ConfigurationTarget.Global);
        this.postStateSync();
        vscode.window.showInformationMessage(
          'FTPManager view location updated. Reload the window if the Activity Bar does not update immediately.',
          'Reload Window',
        ).then((choice) => {
          if (choice === 'Reload Window') {
            void vscode.commands.executeCommand('workbench.action.reloadWindow');
          }
        });
        break;
      }

      case 'updateLanguage': {
        await vscode.workspace
          .getConfiguration('ftpmanager')
          .update('language', msg.language, vscode.ConfigurationTarget.Global);
        this.postStateSync();
        break;
      }

      case 'testConnection': {
        try {
          // If editing an existing connection and password not re-entered, use stored password
          const testPassword = msg.password
            ?? (msg.config.id ? await this.context.secrets.get(PASSWORD_KEY_PREFIX + msg.config.id) : undefined);
          const testPassphrase = msg.passphrase
            ?? (msg.config.id ? await this.context.secrets.get(PASSPHRASE_KEY_PREFIX + msg.config.id) : undefined);
          const client =
            msg.config.protocol === 'sftp'
              ? new SftpClient(msg.config, testPassword, testPassphrase)
              : new FtpClient(msg.config, testPassword);
          await client.connect();
          await client.disconnect();
          this.panel?.webview.postMessage({ type: 'connectionTestResult', success: true });
        } catch (err) {
          this.panel?.webview.postMessage({
            type: 'connectionTestResult',
            success: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        break;
      }

      case 'browsePrivateKey': {
        const files = await vscode.window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: false,
          openLabel: 'Select Private Key',
          filters: { 'Private Key': ['pem', 'key', 'ppk', ''], 'All Files': ['*'] },
        });
        if (files && files.length > 0) {
          this.panel?.webview.postMessage({
            type: 'filePicked',
            target: 'privateKey',
            path: files[0].fsPath,
          });
        }
        break;
      }

      case 'openExternal': {
        await vscode.env.openExternal(vscode.Uri.parse(msg.url));
        break;
      }
    }
  }

  private async exportConnections(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'FTPManager exports include saved passwords. Keep the exported JSON file private.',
      { modal: true },
      'Export Servers',
    );
    if (confirm !== 'Export Servers') return;

    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('ftpmanager-servers.json'),
      saveLabel: 'Export Servers',
      filters: { JSON: ['json'] },
    });
    if (!destination) return;

    const exportFile: ConnectionsExportFile = {
      format: 'ftpmanager.connections',
      version: 1,
      exportedAt: new Date().toISOString(),
      connections: await this.connectionManager.getExportedConnections(),
    };

    await vscode.workspace.fs.writeFile(
      destination,
      new TextEncoder().encode(JSON.stringify(exportFile, null, 2)),
    );
    vscode.window.showInformationMessage(
      `Exported ${exportFile.connections.length} FTPManager server(s). Keep this file private; it contains passwords.`,
    );
  }

  private async importConnections(): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      'Only import FTPManager server files you trust. Imported files can replace existing server settings and passwords.',
      { modal: true },
      'Import Servers',
    );
    if (confirm !== 'Import Servers') return;

    const files = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      openLabel: 'Import Servers',
      filters: { JSON: ['json'] },
    });
    if (!files || files.length === 0) return;

    const raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(files[0]));
    const parsed = JSON.parse(raw) as Partial<ConnectionsExportFile>;
    if (
      parsed.format !== 'ftpmanager.connections' ||
      parsed.version !== 1 ||
      !Array.isArray(parsed.connections)
    ) {
      throw new Error('Invalid FTPManager export file.');
    }

    await this.connectionManager.importConnections(parsed.connections);
    this.postStateSync();
    vscode.window.showInformationMessage(`Imported ${parsed.connections.length} FTPManager server(s).`);
  }

  private getWebviewHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'webview.css'));
    const nonce = randomUUID().replace(/-/g, '');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>FTP Manager</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.panel?.dispose();
  }
}
