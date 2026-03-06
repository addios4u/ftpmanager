import type { FtpConnectionConfig, FtpConnectionInfo } from './types.js';

// Webview → Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'saveConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'testConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'deleteConnection'; connectionId: string }
  | { type: 'browsePrivateKey' }
  | { type: 'openExternal'; url: string };

// Extension → Webview
export type ExtensionMessage =
  | { type: 'stateSync'; connections: FtpConnectionInfo[] }
  | { type: 'connectionTestResult'; success: boolean; error?: string }
  | { type: 'filePicked'; target: 'privateKey'; path: string }
  | { type: 'error'; message: string };

export type { FtpConnectionConfig, FtpConnectionInfo };
