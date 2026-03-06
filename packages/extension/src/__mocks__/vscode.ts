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
  parse: (s: string) => {
    // Extract fsPath from a file:// URI (e.g. file:///path/to/file -> /path/to/file)
    const m = s.match(/^file:\/\/([^?#]*)/);
    const fsPath = m ? decodeURIComponent(m[1]) : s;
    return { fsPath, toString: () => s };
  },
};

export enum ViewColumn {
  One = 1,
  Two = 2,
  Three = 3,
  Active = -1,
  Beside = -2,
}

export enum ProgressLocation {
  SourceControl = 1,
  Window = 10,
  Notification = 15,
}

export const env = {
  clipboard: {
    writeText: vi.fn(),
    readText: vi.fn(async () => ''),
  },
  openExternal: vi.fn(),
};

export const window = {
  showErrorMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showWarningMessage: vi.fn(),
  showInputBox: vi.fn(),
  showOpenDialog: vi.fn(),
  showSaveDialog: vi.fn(),
  showQuickPick: vi.fn(),
  createWebviewPanel: vi.fn(),
  createQuickPick: vi.fn(() => makeQuickPick()),
  withProgress: vi.fn(async (_opts: unknown, task: (progress: { report: (v: unknown) => void }) => Promise<unknown>) => {
    return task({ report: vi.fn() });
  }),
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
  static FileNotFound(msg?: string | { toString(): string }) {
    return new FileSystemError(`FileNotFound: ${msg}`);
  }
  static Unavailable(msg?: string | { toString(): string }) {
    return new FileSystemError(`Unavailable: ${msg}`);
  }
  static NoPermissions(msg?: string | { toString(): string }) {
    return new FileSystemError(`NoPermissions: ${msg}`);
  }
  constructor(msg?: string) { super(msg); this.name = 'FileSystemError'; }
}

export const FileChangeType = {
  Changed: 1,
  Created: 2,
  Deleted: 3,
};

export class Disposable {
  constructor(private readonly fn: () => void) {}
  dispose() { this.fn(); }
  static from(...disposables: { dispose(): unknown }[]): Disposable {
    return new Disposable(() => disposables.forEach((d) => d.dispose()));
  }
}

export class DataTransferItem {
  constructor(public value: unknown) {}
}

export class DataTransfer {
  private data = new Map<string, DataTransferItem>();
  set(type: string, item: DataTransferItem) { this.data.set(type, item); }
  get(type: string) { return this.data.get(type); }
}

export enum QuickPickItemKind {
  Default = 0,
  Separator = -1,
}

function makeQuickPick() {
  return {
    items: [] as unknown[],
    placeholder: '',
    title: '',
    busy: false,
    matchOnDescription: false,
    matchOnDetail: false,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    onDidChangeValue: vi.fn((_cb: (value: string) => void) => ({ dispose: vi.fn() })),
    onDidAccept: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
    onDidHide: vi.fn((_cb: () => void) => ({ dispose: vi.fn() })),
    activeItems: [] as unknown[],
    selectedItems: [] as unknown[],
    value: '',
  };
}
