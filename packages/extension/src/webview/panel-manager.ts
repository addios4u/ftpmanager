import * as vscode from 'vscode';
import { randomUUID } from 'crypto';
import { PASSWORD_KEY_PREFIX, PASSPHRASE_KEY_PREFIX } from '@ftpmanager/shared';
import type { WebviewMessage } from '@ftpmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import { FtpClient } from '../services/ftp-client.js';
import { SftpClient } from '../services/sftp-client.js';

export class WebviewPanelManager {
  private panel: vscode.WebviewPanel | undefined;
  private pendingEditId: string | undefined;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly connectionManager: ConnectionManager,
  ) {}

  openConnectionDialog(editId?: string): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.panel.webview.postMessage({
        type: 'stateSync',
        connections: this.connectionManager.getConnectionInfos(),
      });
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
        await this.handleMessage(msg);
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
        this.panel?.webview.postMessage({
          type: 'stateSync',
          connections: this.connectionManager.getConnectionInfos(),
        });
        if (this.pendingEditId) {
          this.panel?.webview.postMessage({ type: 'openEdit', editId: this.pendingEditId });
          this.pendingEditId = undefined;
        }
        break;
      }

      case 'saveConnection': {
        await this.connectionManager.saveConnection(msg.config, msg.password, msg.passphrase);
        this.panel?.webview.postMessage({
          type: 'stateSync',
          connections: this.connectionManager.getConnectionInfos(),
        });
        break;
      }

      case 'deleteConnection': {
        await this.connectionManager.deleteConnection(msg.connectionId);
        this.panel?.webview.postMessage({
          type: 'stateSync',
          connections: this.connectionManager.getConnectionInfos(),
        });
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
