// Minimal vscode mock for vitest
import { vi } from 'vitest';

export class EventEmitter<T> {
  private listeners: Array<(e: T) => void> = [];
  readonly event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
  };
  fire(data: T): void {
    for (const l of this.listeners) l(data);
  }
  dispose(): void {
    this.listeners = [];
  }
}

export class TreeItem {
  contextValue?: string;
  iconPath?: unknown;
  description?: string;
  id?: string;
  command?: unknown;
  constructor(
    public label: string,
    public collapsibleState?: number,
  ) {}
}

export enum TreeItemCollapsibleState {
  None = 0,
  Collapsed = 1,
  Expanded = 2,
}

export class ThemeIcon {
  constructor(public id: string) {}
}

export const Uri = {
  joinPath: (_base: unknown, ...parts: string[]) => ({ fsPath: parts.join('/'), toString: () => parts.join('/') }),
  file: (path: string) => ({ fsPath: path, toString: () => path }),
  parse: (s: string) => ({ toString: () => s }),
};

export const window = {
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInputBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  createWebviewPanel: vi.fn(),
};

export const workspace = {
  registerFileSystemProvider: vi.fn(),
  openTextDocument: vi.fn(),
  fs: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
};

export const commands = {
  registerCommand: vi.fn(),
  executeCommand: vi.fn(),
};

export const l10n = {
  t: (msg: string, ..._args: unknown[]) => msg,
};

export const FileType = {
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
};

export class FileSystemError extends Error {
  static FileNotFound(msg?: string) { return new FileSystemError(msg ?? 'FileNotFound'); }
  constructor(msg?: string) { super(msg); }
}

export class DataTransferItem {
  constructor(public value: unknown) {}
}

export class DataTransfer {
  private data = new Map<string, DataTransferItem>();
  set(type: string, item: DataTransferItem) { this.data.set(type, item); }
  get(type: string) { return this.data.get(type); }
}
