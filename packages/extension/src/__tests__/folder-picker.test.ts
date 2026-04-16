import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { pickRemoteFolder } from '../services/folder-picker.js';
import type { IFtpClient } from '../services/ftp-client.js';
import type { RemoteFileEntry } from '@ftpmanager/shared';

function makeEntry(name: string, type: 'file' | 'directory' | 'symlink' = 'file'): RemoteFileEntry {
  return { name, type, size: 0, modifiedAt: new Date(0) };
}

function makeMockClient(overrides: Partial<IFtpClient> = {}): IFtpClient {
  return {
    connect: vi.fn(),
    disconnect: vi.fn(),
    list: vi.fn(async () => []),
    downloadFile: vi.fn(),
    downloadFolder: vi.fn(),
    uploadFile: vi.fn(),
    uploadFolder: vi.fn(),
    mkdir: vi.fn(),
    delete: vi.fn(),
    rmdir: vi.fn(),
    rename: vi.fn(),
    getContent: vi.fn(async () => Buffer.from('')),
    putContent: vi.fn(),
    pwd: vi.fn(),
    chmod: vi.fn(),
    ...overrides,
  } as unknown as IFtpClient;
}

/**
 * makeQpMock — selectLabel이 주어지면 items가 세팅된 직후 onDidAccept를 트리거.
 * undefined이면 onDidHide를 트리거 (ESC).
 */
function makeQpMock(selectLabel?: string) {
  let _items: vscode.QuickPickItem[] = [];
  let acceptCb: (() => void) | undefined;
  let hideCb: (() => void) | undefined;

  const qp = {
    title: '',
    placeholder: '',
    busy: false,
    get items(): vscode.QuickPickItem[] { return _items; },
    set items(v: vscode.QuickPickItem[]) {
      _items = v;
      // Callbacks must be registered before items is set (mirrors production flow).
      Promise.resolve().then(() => {
        if (selectLabel !== undefined) {
          acceptCb?.();
        } else {
          hideCb?.();
        }
      });
    },
    get selectedItems(): vscode.QuickPickItem[] {
      return _items.filter((i) => i.label === selectLabel);
    },
    show: vi.fn(),
    dispose: vi.fn(),
    onDidAccept: vi.fn((cb: () => void) => { acceptCb = cb; return { dispose: vi.fn() }; }),
    onDidHide: vi.fn((cb: () => void) => { hideCb = cb; return { dispose: vi.fn() }; }),
  };
  return qp;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('pickRemoteFolder', () => {
  it('현재 폴더 확정 항목 선택 시 현재 경로를 반환한다', async () => {
    const qp = makeQpMock('$(check) Search in current folder: {0}');
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({ list: vi.fn(async () => [makeEntry('sub', 'directory')]) });
    const result = await pickRemoteFolder(client, 'c1', '/');

    expect(result).toBe('/');
    expect(qp.dispose).toHaveBeenCalled();
  });

  it('ESC(onDidHide) 시 undefined를 반환한다', async () => {
    const qp = makeQpMock(undefined);
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({ list: vi.fn(async () => []) });
    const result = await pickRemoteFolder(client, 'c1', '/');

    expect(result).toBeUndefined();
  });

  it('하위 폴더 선택 후 확정 시 해당 경로를 반환한다', async () => {
    const qp1 = makeQpMock('$(folder) sub');
    const qp2 = makeQpMock('$(check) Search in current folder: {0}');

    vi.spyOn(vscode.window, 'createQuickPick')
      .mockReturnValueOnce(qp1 as never)
      .mockReturnValueOnce(qp2 as never);

    const client = makeMockClient({
      list: vi.fn()
        .mockResolvedValueOnce([makeEntry('sub', 'directory')])
        .mockResolvedValueOnce([]),
    });

    const result = await pickRemoteFolder(client, 'c1', '/');
    expect(result).toBe('/sub');
  });

  it('루트가 아닐 때 .. 선택 시 상위 경로로 이동 후 확정할 수 있다', async () => {
    const qp1 = makeQpMock('$(arrow-left) ..');
    const qp2 = makeQpMock('$(check) Search in current folder: {0}');

    vi.spyOn(vscode.window, 'createQuickPick')
      .mockReturnValueOnce(qp1 as never)
      .mockReturnValueOnce(qp2 as never);

    const client = makeMockClient({
      list: vi.fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]),
    });

    const result = await pickRemoteFolder(client, 'c1', '/parent/child');
    expect(result).toBe('/parent');
  });

  it('루트에서는 .. 항목이 표시되지 않는다', async () => {
    const qp = makeQpMock('$(check) Search in current folder: {0}');
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({ list: vi.fn(async () => []) });
    await pickRemoteFolder(client, 'c1', '/');

    const hasGoUp = qp.items.some((i) => i.label === '$(arrow-left) ..');
    expect(hasGoUp).toBe(false);
  });

  it('client.list 에러 시 undefined를 반환한다', async () => {
    const qp = makeQpMock('$(check) Search in current folder: {0}');
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({ list: vi.fn().mockRejectedValueOnce(new Error('conn fail')) });
    const result = await pickRemoteFolder(client, 'c1', '/');

    expect(result).toBeUndefined();
  });

  it('파일 항목은 목록에 포함하지 않는다', async () => {
    const qp = makeQpMock('$(check) Search in current folder: {0}');
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({
      list: vi.fn(async () => [
        makeEntry('readme.txt', 'file'),
        makeEntry('images', 'directory'),
      ]),
    });
    await pickRemoteFolder(client, 'c1', '/');

    const folderItems = qp.items.filter((i) => i.label.startsWith('$(folder)'));
    expect(folderItems).toHaveLength(1);
    expect(folderItems[0].label).toBe('$(folder) images');
  });
});
