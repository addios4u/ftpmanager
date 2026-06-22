import * as vscode from 'vscode';
import type { FtpConnectionConfig, FtpConnectionInfo } from '@ftpmanager/shared';
import { CONNECTIONS_KEY, PASSWORD_KEY_PREFIX, PASSPHRASE_KEY_PREFIX } from '@ftpmanager/shared';
import type { IFtpClient } from './ftp-client.js';
import { FtpClient } from './ftp-client.js';
import { SftpClient } from './sftp-client.js';
import { HostTrustStore, createHostKeyVerifier, type HostKeyVerifier } from './host-trust.js';

export interface ExportedConnection {
  config: FtpConnectionConfig;
  password?: string;
  passphrase?: string;
}

export class ConnectionManager {
  private readonly context: vscode.ExtensionContext;
  private readonly clients = new Map<string, IFtpClient>();
  private readonly connectedIds = new Set<string>();
  private readonly connecting = new Map<string, Promise<void>>();
  private readonly keepAliveTimers = new Map<string, ReturnType<typeof setInterval>>();
  private readonly keepAliveRunningIds = new Set<string>();

  private readonly _onDidChangeConnections = new vscode.EventEmitter<void>();
  readonly onDidChangeConnections = this._onDidChangeConnections.event;

  private readonly _onDidChangeConnectionState = new vscode.EventEmitter<{
    connectionId: string;
    connected: boolean;
  }>();
  readonly onDidChangeConnectionState = this._onDidChangeConnectionState.event;

  private readonly hostTrust: HostTrustStore;
  private readonly verifyHostKey: HostKeyVerifier;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.hostTrust = new HostTrustStore(context);
    this.verifyHostKey = createHostKeyVerifier(this.hostTrust);
  }

  private isStaleConnectionError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return /client is closed|FIN packet|ECONNRESET|ETIMEDOUT|ENOTCONN|socket hang up|connection lost|No response from server/i.test(msg);
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

  async getExportedConnections(): Promise<ExportedConnection[]> {
    const exported: ExportedConnection[] = [];
    for (const config of this.getConnections()) {
      exported.push({
        config,
        password: await this.context.secrets.get(PASSWORD_KEY_PREFIX + config.id),
        passphrase: await this.context.secrets.get(PASSPHRASE_KEY_PREFIX + config.id),
      });
    }
    return exported;
  }

  async importConnections(importedConnections: ExportedConnection[]): Promise<void> {
    const connections = this.getConnections();
    const nextConnections = [...connections];

    for (const imported of importedConnections) {
      const existingIndex = nextConnections.findIndex((connection) => (
        connection.id === imported.config.id || connection.name === imported.config.name
      ));

      if (existingIndex >= 0) {
        const existing = nextConnections[existingIndex];
        if (this.connectedIds.has(existing.id)) {
          await this.disconnect(existing.id);
        }
        if (existing.id !== imported.config.id) {
          await this.context.secrets.delete(PASSWORD_KEY_PREFIX + existing.id);
          await this.context.secrets.delete(PASSPHRASE_KEY_PREFIX + existing.id);
        }
        nextConnections[existingIndex] = imported.config;
      } else {
        nextConnections.push(imported.config);
      }

      if (imported.password !== undefined) {
        await this.context.secrets.store(PASSWORD_KEY_PREFIX + imported.config.id, imported.password);
      } else {
        await this.context.secrets.delete(PASSWORD_KEY_PREFIX + imported.config.id);
      }

      if (imported.passphrase !== undefined) {
        await this.context.secrets.store(PASSPHRASE_KEY_PREFIX + imported.config.id, imported.passphrase);
      } else {
        await this.context.secrets.delete(PASSPHRASE_KEY_PREFIX + imported.config.id);
      }
    }

    await this.context.globalState.update(CONNECTIONS_KEY, nextConnections);
    this._onDidChangeConnections.fire();
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

    if (password) {
      await this.context.secrets.store(PASSWORD_KEY_PREFIX + config.id, password);
    }
    if (passphrase) {
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
    await this.hostTrust.remove(id);
    this._onDidChangeConnections.fire();
  }

  async connect(
    id: string,
    signal?: AbortSignal,
    onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
  ): Promise<void> {
    const existingConnect = this.connecting.get(id);
    if (existingConnect) {
      await existingConnect;
      if (!this.keepAliveTimers.has(id)) this.startKeepAlive(id);
      return;
    }

    const connectPromise = this.connectInternal(id, signal, onRetry);
    this.connecting.set(id, connectPromise);
    try {
      await connectPromise;
    } finally {
      if (this.connecting.get(id) === connectPromise) {
        this.connecting.delete(id);
      }
    }
  }

  private async connectInternal(
    id: string,
    signal?: AbortSignal,
    onRetry?: (attempt: number, maxAttempts: number, delayMs: number) => void,
  ): Promise<void> {
    const config = this.getConnection(id);
    if (!config) throw new Error(`Connection not found: ${id}`);
    if (this.connectedIds.has(id)) {
      if (!this.keepAliveTimers.has(id)) this.startKeepAlive(id);
      return;
    }

    const password = await this.context.secrets.get(PASSWORD_KEY_PREFIX + id);
    const passphrase = await this.context.secrets.get(PASSPHRASE_KEY_PREFIX + id);

    const MAX_RETRIES = 3;
    let lastErr: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (signal?.aborted) throw new Error('Cancelled');

      if (attempt > 0) {
        const delayMs = Math.pow(2, attempt - 1) * 2_000; // 2s, 4s, 8s
        onRetry?.(attempt, MAX_RETRIES, delayMs);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delayMs);
          signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('Cancelled')); }, { once: true });
        });
        if (signal?.aborted) throw new Error('Cancelled');
      }

      const client: IFtpClient =
        config.protocol === 'sftp'
          ? new SftpClient(config, password, passphrase, this.verifyHostKey)
          : new FtpClient(config, password, this.verifyHostKey);

      try {
        await client.connect(signal);
        if (signal?.aborted) return;
        this.clients.set(id, client);
        this.connectedIds.add(id);
        this.startKeepAlive(id);
        this._onDidChangeConnectionState.fire({ connectionId: id, connected: true });
        return;
      } catch (err) {
        lastErr = err;
        const msg = (err instanceof Error ? err.message : String(err));
        const isRetryable = /421|too many/i.test(msg);
        if (!isRetryable || attempt >= MAX_RETRIES) throw err;
      }
    }
    throw lastErr;
  }

  async reconnect(id: string): Promise<void> {
    await this.connecting.get(id).catch(() => {});
    this.connecting.delete(id);
    this.stopKeepAlive(id);
    const client = this.clients.get(id);
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
      this.clients.delete(id);
    }
    this.connectedIds.delete(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: false });
    await this.connect(id);
  }

  async disconnect(id: string): Promise<void> {
    await this.connecting.get(id).catch(() => {});
    this.connecting.delete(id);
    this.stopKeepAlive(id);
    const client = this.clients.get(id);
    if (client) {
      await client.disconnect();
      this.clients.delete(id);
    }
    this.connectedIds.delete(id);
    this._onDidChangeConnectionState.fire({ connectionId: id, connected: false });
  }

  private startKeepAlive(id: string): void {
    this.stopKeepAlive(id);
    this.keepAliveTimers.set(id, setInterval(() => {
      void this.runKeepAlive(id);
    }, 60_000));
  }

  private stopKeepAlive(id: string): void {
    const timer = this.keepAliveTimers.get(id);
    if (timer) {
      clearInterval(timer);
      this.keepAliveTimers.delete(id);
    }
    this.keepAliveRunningIds.delete(id);
  }

  private async runKeepAlive(id: string): Promise<void> {
    if (this.keepAliveRunningIds.has(id) || !this.connectedIds.has(id)) return;

    const client = this.clients.get(id);
    if (!client) return;

    this.keepAliveRunningIds.add(id);
    try {
      await client.pwd();
    } catch (err) {
      if (!this.isStaleConnectionError(err) || !this.connectedIds.has(id)) return;

      try {
        await this.reconnect(id);
      } catch {
        const staleClient = this.clients.get(id);
        if (staleClient) {
          try { await staleClient.disconnect(); } catch { /* ignore */ }
        }
        this.clients.delete(id);
        this.connectedIds.delete(id);
        this.stopKeepAlive(id);
        this._onDidChangeConnectionState.fire({ connectionId: id, connected: false });
      }
    } finally {
      this.keepAliveRunningIds.delete(id);
    }
  }

  dispose(): void {
    for (const id of [...this.keepAliveTimers.keys()]) {
      this.stopKeepAlive(id);
    }
    for (const [, client] of this.clients) {
      void client.disconnect();
    }
    this.clients.clear();
    this.connectedIds.clear();
    this.connecting.clear();
    this._onDidChangeConnections.dispose();
    this._onDidChangeConnectionState.dispose();
  }
}
