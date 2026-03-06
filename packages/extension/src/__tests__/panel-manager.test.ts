import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import type { FtpConnectionInfo } from '@ftpmanager/shared';
import type { ConnectionManager } from '../services/connection-manager.js';
import { WebviewPanelManager } from '../webview/panel-manager.js';

// ---------------------------------------------------------------------------
// Mock FtpClient and SftpClient so testConnection never opens real sockets
// ---------------------------------------------------------------------------
vi.mock('../services/ftp-client.js', () => ({
  FtpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

vi.mock('../services/sftp-client.js', () => ({
  SftpClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush all pending promise microtasks without relying on setTimeout. */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeMockWebviewPanel() {
  const postMessage = vi.fn();
  const onDidReceiveMessageHandlers: Array<(msg: unknown) => void> = [];
  const onDidDisposeHandlers: Array<() => void> = [];

  return {
    panel: {
      reveal: vi.fn(),
      dispose: vi.fn(),
      webview: {
        html: '',
        postMessage,
        asWebviewUri: vi.fn((uri: unknown) => uri),
        onDidReceiveMessage: vi.fn((handler: (msg: unknown) => void) => {
          onDidReceiveMessageHandlers.push(handler);
          return { dispose: vi.fn() };
        }),
        cspSource: 'vscode-resource:',
      },
      onDidDispose: vi.fn((handler: () => void) => {
        onDidDisposeHandlers.push(handler);
        return { dispose: vi.fn() };
      }),
    },
    postMessage,
    triggerMessage: (msg: unknown) => {
      onDidReceiveMessageHandlers.forEach((h) => h(msg));
    },
    triggerDispose: () => {
      onDidDisposeHandlers.forEach((h) => h());
    },
  };
}

function makeConnection(id: string): FtpConnectionInfo {
  return {
    id,
    name: `Server ${id}`,
    protocol: 'ftp',
    host: 'example.com',
    port: 21,
    username: 'user',
    remotePath: '/',
    isConnected: false,
  };
}

function makeMockManager(connections: FtpConnectionInfo[] = []) {
  return {
    getConnectionInfos: vi.fn(() => connections),
    saveConnection: vi.fn(),
    deleteConnection: vi.fn(),
  } as unknown as ConnectionManager;
}

const mockContext = {
  extensionUri: { fsPath: '/ext' },
  subscriptions: [],
  secrets: {
    get: vi.fn(async () => undefined),
    store: vi.fn(),
    delete: vi.fn(),
  },
} as unknown as vscode.ExtensionContext;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebviewPanelManager', () => {
  let mockPanel: ReturnType<typeof makeMockWebviewPanel>;
  let manager: ConnectionManager;
  let panelManager: WebviewPanelManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPanel = makeMockWebviewPanel();
    (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mockReturnValue(mockPanel.panel);
    manager = makeMockManager([makeConnection('c1')]);
    panelManager = new WebviewPanelManager(mockContext, manager);
  });

  // -------------------------------------------------------------------------
  describe('openConnectionDialog()', () => {
    it('creates a new webview panel when none exists', () => {
      panelManager.openConnectionDialog();

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
        'ftpmanager.connectionDialog',
        'FTP Manager',
        vscode.ViewColumn.One,
        expect.objectContaining({ enableScripts: true }),
      );
    });

    it('sets panel HTML content after creation', () => {
      panelManager.openConnectionDialog();

      expect(mockPanel.panel.webview.html).toMatch(/<!DOCTYPE html>/);
    });

    it('reveals existing panel when panel already exists', () => {
      panelManager.openConnectionDialog(); // first — creates panel
      panelManager.openConnectionDialog(); // second — should reveal

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledOnce();
      expect(mockPanel.panel.reveal).toHaveBeenCalledOnce();
    });

    it('posts stateSync to existing panel when editId is undefined', () => {
      panelManager.openConnectionDialog(); // create
      mockPanel.postMessage.mockClear();

      panelManager.openConnectionDialog(); // re-open without editId

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'stateSync')).toBe(true);
      expect(calls.some((m) => m.type === 'openEdit')).toBe(false);
    });

    it('posts openEdit to existing panel when editId is provided', () => {
      panelManager.openConnectionDialog(); // create
      mockPanel.postMessage.mockClear();

      panelManager.openConnectionDialog('c1'); // re-open with editId

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'openEdit' && m.editId === 'c1')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling - 'ready'", () => {
    it('posts stateSync when webview sends ready', async () => {
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage({ type: 'ready' });
      await Promise.resolve(); // flush microtasks

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'stateSync')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling - 'saveConnection'", () => {
    const config = makeConnection('c1');

    it('calls connectionManager.saveConnection with config and password', async () => {
      panelManager.openConnectionDialog();

      mockPanel.triggerMessage({ type: 'saveConnection', config, password: 'pw' });
      await Promise.resolve();

      expect(manager.saveConnection).toHaveBeenCalledWith(config, 'pw', undefined);
    });

    it('posts stateSync after saving', async () => {
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage({ type: 'saveConnection', config, password: 'pw' });
      await Promise.resolve();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'stateSync')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling - 'deleteConnection'", () => {
    it('calls connectionManager.deleteConnection', async () => {
      panelManager.openConnectionDialog();

      mockPanel.triggerMessage({ type: 'deleteConnection', connectionId: 'c1' });
      await Promise.resolve();

      expect(manager.deleteConnection).toHaveBeenCalledWith('c1');
    });

    it('posts stateSync after deleting', async () => {
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage({ type: 'deleteConnection', connectionId: 'c1' });
      await Promise.resolve();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'stateSync')).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling - 'testConnection'", () => {
    const config = makeConnection('c1');
    const testMsg = { type: 'testConnection', config, password: 'pw' };

    it('posts connectionTestResult with success true on successful connect', async () => {
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage(testMsg);
      // Flush all pending microtasks / promise chains
      await flushPromises();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(
        calls.some((m) => m.type === 'connectionTestResult' && m.success === true),
      ).toBe(true);
    });

    it('posts connectionTestResult with success false when connect throws', async () => {
      const { FtpClient } = await import('../services/ftp-client.js');
      (FtpClient as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        connect: vi.fn().mockRejectedValueOnce(new Error('refused')),
        disconnect: vi.fn(),
      }));

      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage(testMsg);
      await flushPromises();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(
        calls.some((m) => m.type === 'connectionTestResult' && m.success === false && m.error === 'refused'),
      ).toBe(true);
    });

    it('uses SftpClient for sftp protocol', async () => {
      const { SftpClient } = await import('../services/sftp-client.js');
      panelManager.openConnectionDialog();

      const sftpConfig = { ...config, protocol: 'sftp' as const };
      mockPanel.triggerMessage({ type: 'testConnection', config: sftpConfig, password: 'pw' });
      await flushPromises();

      expect(SftpClient).toHaveBeenCalledWith(sftpConfig, 'pw', undefined);
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling - 'browsePrivateKey'", () => {
    it('calls showOpenDialog with correct filters', async () => {
      (vscode.window.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      panelManager.openConnectionDialog();

      mockPanel.triggerMessage({ type: 'browsePrivateKey' });
      await flushPromises();

      expect(vscode.window.showOpenDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          canSelectFiles: true,
          canSelectMany: false,
        }),
      );
    });

    it('posts filePicked with selected file path', async () => {
      const fakeUri = { fsPath: '/home/user/.ssh/id_rsa' };
      (vscode.window.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce([fakeUri]);
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage({ type: 'browsePrivateKey' });
      await flushPromises();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(
        calls.some(
          (m) => m.type === 'filePicked' && m.target === 'privateKey' && m.path === '/home/user/.ssh/id_rsa',
        ),
      ).toBe(true);
    });

    it('does NOT post filePicked when dialog is cancelled', async () => {
      (vscode.window.showOpenDialog as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
      panelManager.openConnectionDialog();
      mockPanel.postMessage.mockClear();

      mockPanel.triggerMessage({ type: 'browsePrivateKey' });
      await flushPromises();

      const calls = mockPanel.postMessage.mock.calls.map((c) => c[0]);
      expect(calls.some((m) => m.type === 'filePicked')).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe('dispose()', () => {
    it('disposes the panel if it exists', () => {
      panelManager.openConnectionDialog();
      panelManager.dispose();

      expect(mockPanel.panel.dispose).toHaveBeenCalledOnce();
    });

    it('does not throw if panel is undefined', () => {
      expect(() => panelManager.dispose()).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  describe('BUG-006 — timing: onDispose clears internal panel reference', () => {
    it('creates a new panel after the previous one is disposed', () => {
      panelManager.openConnectionDialog();
      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);

      // Simulate user closing the panel
      mockPanel.triggerDispose();

      // Attempt to open again — must create a NEW panel
      const mockPanel2 = makeMockWebviewPanel();
      (vscode.window.createWebviewPanel as ReturnType<typeof vi.fn>).mockReturnValueOnce(
        mockPanel2.panel,
      );
      panelManager.openConnectionDialog();

      expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    });
  });
});
