import type { FtpConnectionConfig, FtpConnectionInfo } from './types.js';

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'saveConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'testConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'deleteConnection'; connectionId: string }
  | { type: 'exportConnections' }
  | { type: 'importConnections' }
  | { type: 'updateViewLocation'; viewLocation: 'explorer' | 'activityBar' }
  | { type: 'browsePrivateKey' }
  | { type: 'openExternal'; url: string };

// Extension → Webview
export type ExtensionMessage =
  | { type: 'stateSync'; connections: FtpConnectionInfo[]; viewLocation?: 'explorer' | 'activityBar' }
  | { type: 'connectionTestResult'; success: boolean; error?: string }
  | { type: 'filePicked'; target: 'privateKey'; path: string }
  | { type: 'openEdit'; editId: string }
  | { type: 'error'; message: string };

export type { FtpConnectionConfig, FtpConnectionInfo };
