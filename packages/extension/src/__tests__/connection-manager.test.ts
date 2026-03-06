import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConnectionManager } from '../services/connection-manager.js';
import type { FtpConnectionConfig } from '@ftpmanager/shared';
import { CONNECTIONS_KEY } from '@ftpmanager/shared';

function makeConfig(id: string, overrides: Partial<FtpConnectionConfig> = {}): FtpConnectionConfig {
  return {
    id,
    name: `Server ${id}`,
    protocol: 'ftp',
    host: 'example.com',
    port: 21,
    username: 'user',
    remotePath: '/',
    ...overrides,
  };
}

function makeContext(initial: FtpConnectionConfig[] = []) {
  const store = new Map<string, unknown>([[CONNECTIONS_KEY, initial]]);
  const secrets = new Map<string, string>();
  return {
    globalState: {
      get: <T>(key: string, def: T): T => (store.has(key) ? (store.get(key) as T) : def),
      update: vi.fn(async (key: string, value: unknown) => { store.set(key, value); }),
    },
    secrets: {
      get: vi.fn(async (key: string) => secrets.get(key)),
      store: vi.fn(async (key: string, value: string) => { secrets.set(key, value); }),
      delete: vi.fn(async (key: string) => { secrets.delete(key); }),
    },
  } as unknown as import('vscode').ExtensionContext;
}

describe('ConnectionManager', () => {
  let ctx: ReturnType<typeof makeContext>;
  let mgr: ConnectionManager;

  beforeEach(() => {
    ctx = makeContext();
    mgr = new ConnectionManager(ctx);
  });

  it('returns empty connections by default', () => {
    expect(mgr.getConnections()).toEqual([]);
  });

  it('saves a new connection', async () => {
    const cfg = makeConfig('a1');
    await mgr.saveConnection(cfg, 'secret');
    expect(mgr.getConnections()).toHaveLength(1);
    expect(mgr.getConnections()[0].id).toBe('a1');
    expect(ctx.secrets.store).toHaveBeenCalledWith(expect.stringContaining('a1'), 'secret');
  });

  it('updates an existing connection', async () => {
    const cfg = makeConfig('a1');
    await mgr.saveConnection(cfg);
    const updated = { ...cfg, name: 'Updated' };
    await mgr.saveConnection(updated);
    expect(mgr.getConnections()).toHaveLength(1);
    expect(mgr.getConnections()[0].name).toBe('Updated');
  });

  it('deletes a connection', async () => {
    await mgr.saveConnection(makeConfig('a1'));
    await mgr.saveConnection(makeConfig('a2'));
    await mgr.deleteConnection('a1');
    const ids = mgr.getConnections().map((c) => c.id);
    expect(ids).toEqual(['a2']);
    expect(ctx.secrets.delete).toHaveBeenCalled();
  });

  it('isConnected returns false initially', () => {
    expect(mgr.isConnected('any')).toBe(false);
  });

  it('getConnection returns undefined for unknown id', () => {
    expect(mgr.getConnection('unknown')).toBeUndefined();
  });

  it('getConnectionInfos includes isConnected flag', async () => {
    await mgr.saveConnection(makeConfig('a1'));
    const infos = mgr.getConnectionInfos();
    expect(infos[0].isConnected).toBe(false);
  });

  it('fires onDidChangeConnections on save', async () => {
    const listener = vi.fn();
    mgr.onDidChangeConnections(listener);
    await mgr.saveConnection(makeConfig('a1'));
    expect(listener).toHaveBeenCalledOnce();
  });

  it('fires onDidChangeConnections on delete', async () => {
    await mgr.saveConnection(makeConfig('a1'));
    const listener = vi.fn();
    mgr.onDidChangeConnections(listener);
    await mgr.deleteConnection('a1');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('reorderConnections reorders by given id array', async () => {
    await mgr.saveConnection(makeConfig('a1'));
    await mgr.saveConnection(makeConfig('a2'));
    await mgr.saveConnection(makeConfig('a3'));
    await mgr.reorderConnections(['a3', 'a1', 'a2']);
    expect(mgr.getConnections().map((c) => c.id)).toEqual(['a3', 'a1', 'a2']);
  });

  it('reorderConnections appends ids not in orderedIds', async () => {
    await mgr.saveConnection(makeConfig('a1'));
    await mgr.saveConnection(makeConfig('a2'));
    await mgr.reorderConnections(['a2']);
    expect(mgr.getConnections().map((c) => c.id)).toEqual(['a2', 'a1']);
  });

  it('connect throws for unknown connection id', async () => {
    await expect(mgr.connect('nonexistent')).rejects.toThrow('Connection not found');
  });

  it('getClient returns undefined for unconnected id', () => {
    expect(mgr.getClient('a1')).toBeUndefined();
  });
});
