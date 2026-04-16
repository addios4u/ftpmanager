# Search From Folder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 특정 폴더를 시작점으로 원격 파일을 검색할 수 있도록 — 폴더 우클릭 컨텍스트 메뉴와 드릴다운 폴더 선택기 두 가지 진입점 제공.

**Architecture:** `FolderPickerService`(`folder-picker.ts`)를 신규 서비스로 분리하여 드릴다운 QuickPick UI 로직을 캡슐화한다. 기존 `searchFiles` 커맨드 핸들러는 서버/디렉터리 노드 컨텍스트에 따라 폴더 선택기를 호출하거나 건너뛰는 분기를 추가한다. 폴더 노드의 컨텍스트 메뉴에 커맨드를 추가하고 4개 NLS 번들에 신규 문자열을 추가한다.

**Tech Stack:** TypeScript, VSCode Extension API (`vscode.window.createQuickPick`), Vitest

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `packages/extension/src/services/folder-picker.ts` |
| **Create** | `packages/extension/src/__tests__/folder-picker.test.ts` |
| **Modify** | `packages/extension/src/extension.ts` |
| **Modify** | `packages/extension/package.json` |
| **Modify** | `packages/extension/l10n/bundle.l10n.json` |
| **Modify** | `packages/extension/l10n/bundle.l10n.ko.json` |
| **Modify** | `packages/extension/l10n/bundle.l10n.ja.json` |
| **Modify** | `packages/extension/l10n/bundle.l10n.zh-cn.json` |

---

## Task 1: `folder-picker.ts` 서비스 구현 (TDD)

**Files:**
- Create: `packages/extension/src/__tests__/folder-picker.test.ts`
- Create: `packages/extension/src/services/folder-picker.ts`

### Step 1-1: 테스트 파일 작성

`packages/extension/src/__tests__/folder-picker.test.ts` 를 아래 내용으로 생성한다.

```typescript
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
 * makeQpMock — selectLabel 이 주어지면 items 가 세팅된 직후 onDidAccept 를 트리거.
 * undefined 이면 onDidHide 를 트리거 (ESC).
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

  it('ESC(onDidHide) 시 undefined 를 반환한다', async () => {
    const qp = makeQpMock(undefined); // selectLabel 없음 → onDidHide 트리거
    vi.spyOn(vscode.window, 'createQuickPick').mockReturnValueOnce(qp as never);

    const client = makeMockClient({ list: vi.fn(async () => []) });
    const result = await pickRemoteFolder(client, 'c1', '/');

    expect(result).toBeUndefined();
  });

  it('하위 폴더 선택 후 확정 시 해당 경로를 반환한다', async () => {
    // 1st QP: /sub 선택
    const qp1 = makeQpMock('$(folder) sub');
    // 2nd QP: /sub 에서 현재 폴더 확정
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
        .mockResolvedValueOnce([]) // /parent/child 의 하위 폴더
        .mockResolvedValueOnce([]), // /parent 의 하위 폴더
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

  it('client.list 에러 시 undefined 를 반환한다', async () => {
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
```

### Step 1-2: 테스트 실행 — 실패 확인

```bash
cd /Users/addios4u/git/ftpmanager
pnpm --filter ftpmanager exec vitest run src/__tests__/folder-picker.test.ts 2>&1 | tail -20
```

예상: `Cannot find module '../services/folder-picker.js'` 오류로 FAIL

### Step 1-3: `folder-picker.ts` 구현

`packages/extension/src/services/folder-picker.ts` 를 생성한다.

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import type { IFtpClient } from './ftp-client.js';

/**
 * 드릴다운 Quick Pick UI로 원격 폴더를 선택한다.
 * 사용자가 ESC를 누르거나 list 오류 시 undefined 반환.
 */
export async function pickRemoteFolder(
  client: IFtpClient,
  _connectionId: string,
  startPath: string = '/',
): Promise<string | undefined> {
  let currentPath = startPath;

  while (true) {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
    qp.title = vscode.l10n.t('Select start folder');
    qp.placeholder = currentPath;
    qp.busy = true;
    qp.show();

    const selected = await new Promise<vscode.QuickPickItem | undefined>((resolve) => {
      qp.onDidAccept(() => resolve(qp.selectedItems[0]));
      qp.onDidHide(() => resolve(undefined));

      client.list(currentPath).then(
        (list) => {
          const folders = list
            .filter((e) => e.type === 'directory')
            .map((e) => e.name)
            .sort();

          const items: vscode.QuickPickItem[] = [
            { label: `$(check) ${vscode.l10n.t('Search in current folder: {0}', currentPath)}` },
          ];
          if (currentPath !== '/') {
            items.push({ label: '$(arrow-left) ..', description: vscode.l10n.t('Go up') });
          }
          for (const name of folders) {
            items.push({ label: `$(folder) ${name}`, description: name });
          }
          qp.items = items;
          qp.busy = false;
        },
        () => {
          qp.dispose();
          resolve(undefined);
        },
      );
    });

    qp.dispose();

    if (!selected) return undefined;

    const label = selected.label;
    if (label.startsWith('$(check)')) {
      return currentPath;
    } else if (label === '$(arrow-left) ..') {
      currentPath = path.posix.dirname(currentPath) || '/';
    } else {
      const folderName = selected.description ?? label.replace(/^\$\(folder\)\s*/, '');
      currentPath = currentPath === '/' ? `/${folderName}` : `${currentPath}/${folderName}`;
    }
  }
}
```

### Step 1-4: 테스트 실행 — 통과 확인

```bash
pnpm --filter ftpmanager exec vitest run src/__tests__/folder-picker.test.ts 2>&1 | tail -20
```

예상: `6 tests passed`

### Step 1-5: 커밋

```bash
git add packages/extension/src/services/folder-picker.ts \
        packages/extension/src/__tests__/folder-picker.test.ts
git commit -m "feat: add FolderPickerService with drill-down remote folder selection"
```

---

## Task 2: `extension.ts` 검색 핸들러에 폴더 선택 단계 추가

**Files:**
- Modify: `packages/extension/src/extension.ts`

### Step 2-1: `pickRemoteFolder` import 추가

`packages/extension/src/extension.ts` 8번째 줄 아래에 import를 추가한다.

```typescript
// 기존
import { searchByName, searchByContent } from './services/search-service.js';
import type { SearchResult } from './services/search-service.js';

// 변경 후
import { searchByName, searchByContent } from './services/search-service.js';
import type { SearchResult } from './services/search-service.js';
import { pickRemoteFolder } from './services/folder-picker.js';
```

### Step 2-2: 노드 타입 캐스트 확장 및 `rootPath` 결정 로직 교체

`extension.ts` 459번째 줄 `SEARCH_FILES` 핸들러에서 두 가지를 수정한다.

**변경 1** — 노드 캐스트를 `FtpTreeNode`로 교체 (이미 import 되어 있음):

```typescript
// 기존 (line 460):
const n = node as { connectionId?: string } | undefined;

// 변경 후:
const n = node as FtpTreeNode | undefined;
```

**변경 2** — `const rootPath = config.remotePath || '/';` 한 줄을 아래로 교체:

```typescript
// 기존 (line 496):
const rootPath = config.remotePath || '/';

// 변경 후:
let rootPath: string;
if (n?.nodeType === 'directory' && n?.remotePath) {
  // 폴더 우클릭으로 실행 → 폴더 선택 단계 없이 해당 경로 사용
  rootPath = n.remotePath;
} else {
  // 커맨드 팔레트 또는 서버 노드에서 실행 → 드릴다운 폴더 선택
  const picked = await pickRemoteFolder(client, connectionId, config.remotePath || '/');
  if (!picked) return;
  rootPath = picked;
}
```

### Step 2-3: 빌드 타입체크 통과 확인

```bash
pnpm --filter ftpmanager exec tsc --noEmit 2>&1 | head -20
```

예상: 오류 없음

### Step 2-4: 전체 테스트 통과 확인

```bash
pnpm --filter ftpmanager exec vitest run 2>&1 | tail -10
```

예상: 모든 기존 테스트 + 신규 6개 PASS

### Step 2-5: 커밋

```bash
git add packages/extension/src/extension.ts
git commit -m "feat: add folder picker step to searchFiles command handler"
```

---

## Task 3: `package.json` — 디렉터리 노드 컨텍스트 메뉴 추가

**Files:**
- Modify: `packages/extension/package.json`

### Step 3-1: `view/item/context` 배열에 항목 추가

`packages/extension/package.json` 의 `contributes.menus["view/item/context"]` 배열 마지막 항목(현재 `ftpmanager.chmod` 항목) 뒤에 다음을 추가한다.

```json
{
  "command": "ftpmanager.searchFiles",
  "when": "view == ftpmanager.servers && viewItem == directory",
  "group": "5_search@1"
}
```

추가 후 해당 섹션 끝부분:

```json
        {
          "command": "ftpmanager.chmod",
          "when": "view == ftpmanager.servers && viewItem =~ /^file$|^directory$/",
          "group": "9_chmod@1"
        },
        {
          "command": "ftpmanager.searchFiles",
          "when": "view == ftpmanager.servers && viewItem == directory",
          "group": "5_search@1"
        }
      ]
```

### Step 3-2: JSON 문법 검증

```bash
node -e "require('./packages/extension/package.json'); console.log('OK')"
```

예상: `OK`

### Step 3-3: 커밋

```bash
git add packages/extension/package.json
git commit -m "feat: add Search Files context menu entry for directory nodes"
```

---

## Task 4: NLS 번들 4개에 신규 문자열 추가

**Files:**
- Modify: `packages/extension/l10n/bundle.l10n.json` (English)
- Modify: `packages/extension/l10n/bundle.l10n.ko.json`
- Modify: `packages/extension/l10n/bundle.l10n.ja.json`
- Modify: `packages/extension/l10n/bundle.l10n.zh-cn.json`

추가할 키 3개:

| Key | en | ko | ja | zh-cn |
|-----|-----|-----|-----|-------|
| `"Select start folder"` | `"Select start folder"` | `"시작 폴더 선택"` | `"開始フォルダーを選択"` | `"选择起始文件夹"` |
| `"Search in current folder: {0}"` | `"Search in current folder: {0}"` | `"현재 폴더에서 검색: {0}"` | `"現在のフォルダーで検索: {0}"` | `"在当前文件夹中搜索: {0}"` |
| `"Go up"` | `"Go up"` | `"상위 폴더로"` | `"上のフォルダーへ"` | `"返回上级"` |

### Step 4-1: `bundle.l10n.json` (English) — 기존 Search 관련 키 바로 뒤에 추가

`"Select a file to open": "Select a file to open",` 줄 바로 뒤에 삽입:

```json
  "Select start folder": "Select start folder",
  "Search in current folder: {0}": "Search in current folder: {0}",
  "Go up": "Go up",
```

### Step 4-2: `bundle.l10n.ko.json` — 기존 Search 관련 키 바로 뒤에 추가

`"Select a file to open"` 번역 줄 바로 뒤에 삽입:

```json
  "Select start folder": "시작 폴더 선택",
  "Search in current folder: {0}": "현재 폴더에서 검색: {0}",
  "Go up": "상위 폴더로",
```

### Step 4-3: `bundle.l10n.ja.json` — 기존 Search 관련 키 바로 뒤에 추가

```json
  "Select start folder": "開始フォルダーを選択",
  "Search in current folder: {0}": "現在のフォルダーで検索: {0}",
  "Go up": "上のフォルダーへ",
```

### Step 4-4: `bundle.l10n.zh-cn.json` — 기존 Search 관련 키 바로 뒤에 추가

```json
  "Select start folder": "选择起始文件夹",
  "Search in current folder: {0}": "在当前文件夹中搜索: {0}",
  "Go up": "返回上级",
```

### Step 4-5: JSON 문법 검증

```bash
node -e "
  ['bundle.l10n.json','bundle.l10n.ko.json','bundle.l10n.ja.json','bundle.l10n.zh-cn.json']
    .forEach(f => { require('./packages/extension/l10n/' + f); console.log(f, 'OK'); });
"
```

예상: 4개 파일 모두 `OK`

### Step 4-6: 빌드 최종 확인

```bash
pnpm run build 2>&1 | tail -10
```

예상: 오류 없이 빌드 완료

### Step 4-7: 커밋

```bash
git add packages/extension/l10n/
git commit -m "feat: add NLS strings for folder picker UI (en/ko/ja/zh-cn)"
```

---

## 완료 체크리스트

- [ ] `folder-picker.ts` 신규 서비스 생성 및 6개 테스트 통과
- [ ] `extension.ts` 검색 핸들러에 폴더 선택 단계 통합
- [ ] `package.json` 디렉터리 노드 컨텍스트 메뉴 추가
- [ ] 4개 NLS 번들 업데이트
- [ ] `tsc --noEmit` 타입 오류 없음
- [ ] `pnpm run build` 성공
- [ ] 전체 vitest 통과
