import * as vscode from 'vscode';
import type { FtpConnectionConfig, FtpConnectionInfo } from '@ftpmanager/shared';
import { CONNECTIONS_KEY, PASSWORD_KEY_PREFIX, PASSPHRASE_KEY_PREFIX } from '@ftpmanager/shared';
import type { IFtpClient } from './ftp-client.js';
import { FtpClient } from './ftp-client.js';
import { SftpClient } from './sftp-client.js';

export class ConnectionManager {
  private readonly context: vscode.ExtensionContext;
  private readonly clients = new Map<string, IFtpClient>();
  private readonly connectedIds = new Set<string>();

  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  private readonly _onDidChangeConnectionState = new vscode.EventEmitter<{
    connectionId: string;
    connected: boolean;
  }>();
  readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  getConnections(): FtpConnectionConfig[] {
    return this.context.globalState.get<FtpConnectionConfig[]>(CONNECTIONS_KEY, []);
  }

  getConnectionInfos(): FtpConnectionInfo[] {
    return this.getConnections().map((cfg) => ({
      ...cfg,
      isConnected: this.connectedIds.has(cfg.id),
    }));
  }

  getConnection(id: string): FtpConnectionConfig | undefined {
    return this.getConnections().find((c) => c.id === id);
  }

  isConnected(id: string): boolean {
    return this.connectedIds.has(id);
  }

  getClient(id: string): IFtpClient | undefined {
    return this.clients.get(id);
  }

  async saveConnection(
    config: FtpConnectionConfig,
    password?: string,
    passphrase?: string,
  ): Promise<void> {
    const connections = this.getConnections();
    const idx = connections.findIndex((c) => c.id === config.id);
    if (idx >= 0) {
      connections[idx] = config;
    } else {
      connections.push(config);
    }
    await this.context.globalState.update(CONNECTIONS_KEY, connections);

    if (password !== undefined) {
      await this.context.secrets.store(PASSWORD_KEY_PREFIX + config.id, password);
    }
    if (passphrase !== undefined) {
      await this.context.secrets.store(PASSPHRASE_KEY_PREFIX + config.id, passphrase);
    }

    this._onDidChangeConnections.fire();
  }

  async reorderConnections(orderedIds: string[]): Promise<void> {
    const connections = this.getConnections();
    const byId = new Map(connections.map((c) => [c.id, c]));
    const reordered: FtpConnectionConfig[] = [];
    for (const id of orderedIds) {
      const c = byId.get(id);
      if (c) reordered.push(c);
    }
    for (const c of connections) {
      if (!orderedIds.includes(c.id)) reordered.push(c);
    }
    await this.context.globalState.update(CONNECTIONS_KEY, reordered);
    this._onDidChangeConnections.fire();
  }

  async deleteConnection(id: string): Promise<void> {
    if (this.connectedIds.has(id)) {
      await this.disconnect(id);
    }
    const connections = this.getConnections().filter((c) => c.id !== id);
    await this.context.globalState.update(CONNECTIONS_KEY, connections);
    await this.context.secrets.delete(PASSWORD_KEY_PREFIX + id);
    await this.context.secrets.delete(PASSPHRASE_KEY_PREFIX + id);
    this._onDidChangeConnections.fire();
  }

  async connect(id: string, signal?: AbortSignal): Promise<void> {
    const config = this.getConnection(id);
    if (!config) throw new Error(`Connection not found: ${id}`);
    if (this.connectedIds.has(id)) return;

    const password = await this.context.secrets.get(PASSWORD_KEY_PREFIX + id);
    const passphrase = await this.context.secrets.get(PASSPHRASE_KEY_PREFIX + id);

    const client: IFtpClient =
      config.protocol === 'sftp'
        ? new SftpClient(config, password, passphrase)
        : new FtpClient(config, password);

    await client.connect(signal);
    if (signal?.aborted) return; // cancelled before we could register
    this.clients.set(id, client);
    this.connectedIds.add(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: true });
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
    this.connectedIds.delete(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: false });
  }

  dispose(): void {
    for (const [, client] of this.clients) {
      void client.disconnect();
    }
    this.clients.clear();
    this.connectedIds.clear();
    this._onDidChangeConnections.dispose();
    this._onDidChangeConnectionState.dispose();
  }
}
