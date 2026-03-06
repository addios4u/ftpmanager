import { describe, it, expect, vi } from 'vitest';
import { FtpTreeProvider } from '../providers/ftp-tree.js';
import type { FtpTreeNode } from '../providers/ftp-tree.js';
import { DataTransfer, DataTransferItem } from 'vscode';
import type { ConnectionManager } from '../services/connection-manager.js';

function makeMockManager(connections: Array<{ id: string; name: string; remotePath: string; protocol?: string }> = []) {
  return {
    getConnections: vi.fn(() => connections),
    isConnected: vi.fn(() => false),
    getConnection: vi.fn((id: string) => connections.find((c) => c.id === id)),
    getClient: vi.fn(() => undefined),
    connect: vi.fn(),
    reorderConnections: vi.fn(),
    onDidChangeConnections: vi.fn((cb: () => void) => { cb(); return { dispose: vi.fn() }; }),
    onDidChangeConnectionState: vi.fn(() => ({ dispose: vi.fn() })),
  } as unknown as ConnectionManager;
}

const fakeUri = { fsPath: '/extension', joinPath: () => fakeUri };

describe('FtpTreeProvider', () => {
  it('getRootNodes returns a server node per connection', async () => {
    const mgr = makeMockManager([{ id: 'c1', name: 'My Server', remotePath: '/public_html' }]);
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const roots = await provider.getChildren();
    expect(roots).toHaveLength(1);
    expect(roots[0].nodeType).toBe('server');
    expect(roots[0].label).toBe('My Server');
    expect(roots[0].connectionId).toBe('c1');
  });

  it('getChildren of file returns empty array', async () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const fileNode: FtpTreeNode = { nodeType: 'file', label: 'test.txt', connectionId: 'c1', remotePath: '/test.txt' };
    const children = await provider.getChildren(fileNode);
    expect(children).toEqual([]);
  });

  it('getTreeItem sets contextValue server-disconnected when not connected', async () => {
    const mgr = makeMockManager([{ id: 'c1', name: 'My Server', remotePath: '/' }]);
    (mgr.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(false);
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const node: FtpTreeNode = { nodeType: 'server', label: 'My Server', connectionId: 'c1', remotePath: '/' };
    const item = provider.getTreeItem(node);
    expect(item.contextValue).toBe('server-disconnected');
  });

  it('getTreeItem sets contextValue server-connected when connected', async () => {
    const mgr = makeMockManager([{ id: 'c1', name: 'My Server', remotePath: '/' }]);
    (mgr.isConnected as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const node: FtpTreeNode = { nodeType: 'server', label: 'My Server', connectionId: 'c1', remotePath: '/' };
    const item = provider.getTreeItem(node);
    expect(item.contextValue).toBe('server-connected');
  });

  it('getTreeItem sets contextValue to nodeType for file/dir', () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const fileNode: FtpTreeNode = { nodeType: 'file', label: 'file.txt', connectionId: 'c1', remotePath: '/file.txt' };
    expect(provider.getTreeItem(fileNode).contextValue).toBe('file');
    const dirNode: FtpTreeNode = { nodeType: 'directory', label: 'dir', connectionId: 'c1', remotePath: '/dir' };
    expect(provider.getTreeItem(dirNode).contextValue).toBe('directory');
  });

  it('getTreeItem attaches openRemoteFile command to file nodes', () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const node: FtpTreeNode = { nodeType: 'file', label: 'a.txt', connectionId: 'c1', remotePath: '/a.txt' };
    const item = provider.getTreeItem(node);
    expect((item.command as { command: string }).command).toBe('ftpmanager.openRemoteFile');
  });

  it('refresh fires onDidChangeTreeData', () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const listener = vi.fn();
    provider.onDidChangeTreeData(listener);
    provider.refresh();
    expect(listener).toHaveBeenCalled();
  });

  it('handleDrag ignores non-server nodes', () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const dt = new DataTransfer();
    const fileNode: FtpTreeNode = { nodeType: 'file', label: 'f', connectionId: 'c1', remotePath: '/f' };
    provider.handleDrag([fileNode], dt);
    expect(dt.get('application/vnd.code.tree.ftpmanager.servers')).toBeUndefined();
  });

  it('handleDrag sets mime data for server nodes', () => {
    const mgr = makeMockManager();
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const dt = new DataTransfer();
    const serverNode: FtpTreeNode = { nodeType: 'server', label: 'S', connectionId: 'c1', remotePath: '/' };
    provider.handleDrag([serverNode], dt);
    const item = dt.get('application/vnd.code.tree.ftpmanager.servers');
    expect(item).toBeDefined();
    expect((item as DataTransferItem).value).toContain('c1');
  });

  it('handleDrop ignores drop onto non-server targets', async () => {
    const mgr = makeMockManager([{ id: 'c1', name: 'S', remotePath: '/' }]);
    const provider = new FtpTreeProvider(mgr, fakeUri as never);
    const dt = new DataTransfer();
    dt.set('application/vnd.code.tree.ftpmanager.servers', new DataTransferItem(['c1']));
    const fileTarget: FtpTreeNode = { nodeType: 'file', label: 'f', connectionId: 'c1', remotePath: '/f' };
    await provider.handleDrop(fileTarget, dt);
    expect(mgr.reorderConnections).not.toHaveBeenCalled();
  });
});
