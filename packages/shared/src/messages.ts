import type { FtpConnectionConfig, FtpConnectionInfo } from './types.js';

export type FtpManagerLanguage = 'auto' | 'en' | 'fr' | 'ja' | 'ko' | 'zh-cn';

export interface FtpManagerLanguageOption {
  value: FtpManagerLanguage;
  label: string;
}

// Webview -> Extension
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'saveConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'testConnection'; config: FtpConnectionConfig; password?: string; passphrase?: string }
  | { type: 'deleteConnection'; connectionId: string }
  | { type: 'exportConnections' }
  | { type: 'importConnections' }
  | { type: 'updateViewLocation'; viewLocation: 'explorer' | 'activityBar' }
  | { type: 'updateLanguage'; language: FtpManagerLanguage }
  | { type: 'browsePrivateKey' }
  | { type: 'openExternal'; url: string };

// Extension -> Webview
export type ExtensionMessage =
  | {
    type: 'stateSync';
    connections: FtpConnectionInfo[];
    viewLocation?: 'explorer' | 'activityBar';
    language?: FtpManagerLanguage;
    languageOptions?: FtpManagerLanguageOption[];
    vscodeLanguage?: string;
  }
  | { type: 'connectionTestResult'; success: boolean; error?: string }
  | { type: 'filePicked'; target: 'privateKey'; path: string }
  | { type: 'openEdit'; editId: string }
  | { type: 'error'; message: string };

export type { FtpConnectionConfig, FtpConnectionInfo };
