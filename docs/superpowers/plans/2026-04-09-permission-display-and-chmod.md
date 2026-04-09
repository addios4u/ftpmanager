# Permission Display & Chmod Context Menu — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 트리 뷰 파일/폴더에 퍼미션을 `(644)` 형식으로 표시하고, 우클릭으로 퍼미션을 변경할 수 있게 한다.

**Architecture:** `FtpTreeNode`에 `permissions?` 필드를 추가해 `mapEntries()`에서 채우고 `getTreeItem()`에서 description으로 표시한다. `COMMAND_IDS.CHMOD` 커맨드를 shared constants에 추가하고, `extension.ts`에서 `pickPermissions()` → `chmod()` → `refresh()` 흐름으로 처리한다.

**Tech Stack:** TypeScript, VSCode Extension API, 기존 `IFtpClient.chmod()`, `pickPermissions()` (이미 구현됨)

---

## 파일 구조

| 파일 | 변경 |
|------|------|
| `packages/shared/src/constants.ts` | `COMMAND_IDS`에 `CHMOD` 추가 |
| `packages/extension/src/providers/ftp-tree.ts` | `FtpTreeNode`에 `permissions?` 추가, `mapEntries()` + `getTreeItem()` 수정 |
| `packages/extension/src/__tests__/ftp-tree.test.ts` | permissions 관련 테스트 추가 |
| `packages/extension/package.json` | `ftpmanager.chmod` 커맨드 + 컨텍스트 메뉴 등록 |
| `packages/extension/package.nls.json` | `command.chmod` 타이틀 추가 |
| `packages/extension/src/extension.ts` | `CHMOD` 커맨드 핸들러 등록 |
| `packages/extension/l10n/bundle.l10n.json` | i18n 문자열 추가 |

---

## Task 1: FtpTreeNode에 permissions 추가 + 트리 표시

**Files:**
- Modify: `packages/shared/src/constants.ts`
- Modify: `packages/extension/src/providers/ftp-tree.ts:17-22` (FtpTreeNode interface)
- Modify: `packages/extension/src/providers/ftp-tree.ts:294-311` (mapEntries)
- Modify: `packages/extension/src/providers/ftp-tree.ts:131-152` (getTreeItem)
- Modify: `packages/extension/src/__tests__/ftp-tree.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/extension/src/__tests__/ftp-tree.test.ts`에 다음 테스트를 추가한다. 기존 테스트 블록 끝에 추가:

```typescript
it('getTreeItem sets description to "(644)" for file node with permissions', () => {
  const node: FtpTreeNode = {
    nodeType: 'file',
    label: 'index.php',
    connectionId: 'conn1',
    remotePath: '/index.php',
    permissions: '644',
  };
  const item = provider.getTreeItem(node);
  expect(item.description).toBe('(644)');
});

it('getTreeItem sets description to "(755)" for directory node with permissions', () => {
  const node: FtpTreeNode = {
    nodeType: 'directory',
    label: 'assets',
    connectionId: 'conn1',
    remotePath: '/assets',
    permissions: '755',
  };
  const item = provider.getTreeItem(node);
  expect(item.description).toBe('(755)');
});

it('getTreeItem does not set description when permissions is undefined', () => {
  const node: FtpTreeNode = {
    nodeType: 'file',
    label: 'legacy.sh',
    connectionId: 'conn1',
    remotePath: '/legacy.sh',
  };
  const item = provider.getTreeItem(node);
  expect(item.description).toBeUndefined();
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager test -- --reporter=verbose ftp-tree 2>&1 | tail -20
```

Expected: FAIL — `FtpTreeNode` 타입에 `permissions` 없다는 타입 에러 또는 `item.description` undefined

- [ ] **Step 3: shared constants에 CHMOD 추가**

`packages/shared/src/constants.ts`의 `COMMAND_IDS`에 다음 줄 추가 (`DUPLICATE` 뒤):

```typescript
  CHMOD: 'ftpmanager.chmod',
```

결과:
```typescript
export const COMMAND_IDS = {
  ADD_SERVER: 'ftpmanager.addServer',
  EDIT_SERVER: 'ftpmanager.editServer',
  DELETE_SERVER: 'ftpmanager.deleteServer',
  CONNECT: 'ftpmanager.connect',
  DISCONNECT: 'ftpmanager.disconnect',
  REFRESH: 'ftpmanager.refresh',
  UPLOAD_FILE: 'ftpmanager.uploadFile',
  DOWNLOAD_FILE: 'ftpmanager.downloadFile',
  DOWNLOAD_FOLDER: 'ftpmanager.downloadFolder',
  NEW_FOLDER: 'ftpmanager.newFolder',
  NEW_FILE: 'ftpmanager.newFile',
  RENAME: 'ftpmanager.rename',
  DELETE_REMOTE: 'ftpmanager.deleteRemote',
  COPY_REMOTE_PATH: 'ftpmanager.copyRemotePath',
  UPLOAD_TO_SERVER: 'ftpmanager.uploadToServer',
  OPEN_REMOTE_FILE: 'ftpmanager.openRemoteFile',
  SEARCH_FILES: 'ftpmanager.searchFiles',
  DUPLICATE: 'ftpmanager.duplicate',
  CHMOD: 'ftpmanager.chmod',
} as const;
```

- [ ] **Step 4: shared 패키지 빌드**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter @ftpmanager/shared build
```

Expected: 에러 없이 완료

- [ ] **Step 5: FtpTreeNode 인터페이스에 permissions 추가**

`packages/extension/src/providers/ftp-tree.ts`의 `FtpTreeNode` 인터페이스:

```typescript
export interface FtpTreeNode {
  nodeType: FtpNodeType;
  label: string;
  connectionId: string;
  remotePath: string;
  permissions?: string;
}
```

- [ ] **Step 6: mapEntries()에서 permissions 전달**

`packages/extension/src/providers/ftp-tree.ts`의 `mapEntries()` 메서드에서 노드 생성 부분:

```typescript
  private mapEntries(
    entries: import('@ftpmanager/shared').RemoteFileEntry[],
    connectionId: string,
    remotePath: string,
  ): FtpTreeNode[] {
    return entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .sort((a, b) => {
        if (a.type === b.type) return a.name.localeCompare(b.name);
        return a.type === 'directory' ? -1 : 1;
      })
      .map((entry): FtpTreeNode => ({
        nodeType: entry.type === 'directory' ? 'directory' : 'file',
        label: entry.name,
        connectionId,
        remotePath: remotePath.endsWith('/') ? remotePath + entry.name : remotePath + '/' + entry.name,
        permissions: entry.permissions,
      }));
  }
```

- [ ] **Step 7: getTreeItem()에서 description 설정**

`packages/extension/src/providers/ftp-tree.ts`의 `getTreeItem()` 메서드에서 `node.nodeType === 'server'` 블록 아래에 추가:

```typescript
  getTreeItem(node: FtpTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, getCollapsibleState(node.nodeType));
    item.contextValue = getContextValue(node, this.connectionManager);
    item.iconPath = getIcon(node, this.connectionManager, this.extensionUri);

    if (node.nodeType === 'server') {
      const gen = this.disconnectGen.get(node.connectionId) ?? 0;
      item.id = `${node.connectionId}-${gen}`;
      const connected = this.connectionManager.isConnected(node.connectionId);
      item.description = connected ? vscode.l10n.t('Connected') : '';
    }

    if ((node.nodeType === 'file' || node.nodeType === 'directory') && node.permissions) {
      item.description = `(${node.permissions})`;
    }

    if (node.nodeType === 'file') {
      item.command = {
        command: 'ftpmanager.openRemoteFile',
        title: 'Open Remote File',
        arguments: [node],
      };
    }

    return item;
  }
```

- [ ] **Step 8: 테스트 실행 — 통과 확인**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager test -- --reporter=verbose ftp-tree 2>&1 | tail -20
```

Expected: ftp-tree 테스트 전체 PASS

- [ ] **Step 9: 빌드 확인**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 10: 커밋**

```bash
cd /Users/addios4u/git/ftpmanager
git add packages/shared/src/constants.ts \
        packages/extension/src/providers/ftp-tree.ts \
        packages/extension/src/__tests__/ftp-tree.test.ts
git commit -m "feat: show permissions in tree view as (644) description"
```

---

## Task 2: package.json에 chmod 커맨드 + 메뉴 등록

**Files:**
- Modify: `packages/extension/package.json`
- Modify: `packages/extension/package.nls.json`

- [ ] **Step 1: package.json commands에 chmod 추가**

`packages/extension/package.json`의 `"commands"` 배열에 `duplicate` 항목 뒤에 추가:

```json
{
  "command": "ftpmanager.chmod",
  "title": "%command.chmod%",
  "category": "%category.ftpManager%"
}
```

- [ ] **Step 2: package.json menus에 chmod 추가**

`packages/extension/package.json`의 `"view/item/context"` 배열에 `copyRemotePath` 항목 뒤에 추가:

```json
{
  "command": "ftpmanager.chmod",
  "when": "view == ftpmanager.servers && viewItem =~ /^file$|^directory$/",
  "group": "9_chmod@1"
}
```

- [ ] **Step 3: package.nls.json에 커맨드 타이틀 추가**

`packages/extension/package.nls.json`에 `command.duplicate` 뒤에 추가:

```json
"command.chmod": "Change Permissions"
```

- [ ] **Step 4: bundle.l10n.json에 i18n 문자열 추가**

`packages/extension/l10n/bundle.l10n.json`의 마지막 항목 뒤에 추가:

```json
  "Change Permissions": "Change Permissions",
  "Failed to change permissions: {0}": "Failed to change permissions: {0}"
```

- [ ] **Step 5: 빌드 확인**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 6: 커밋**

```bash
cd /Users/addios4u/git/ftpmanager
git add packages/extension/package.json \
        packages/extension/package.nls.json \
        packages/extension/l10n/bundle.l10n.json
git commit -m "feat: register chmod command and context menu"
```

---

## Task 3: extension.ts에 chmod 커맨드 핸들러 등록

**Files:**
- Modify: `packages/extension/src/extension.ts`

`COMMAND_IDS.DUPLICATE` 커맨드 핸들러가 끝나는 지점(`}),`) 바로 뒤에 다음을 추가한다.

- [ ] **Step 1: chmod 커맨드 핸들러 작성**

`extension.ts`의 `context.subscriptions.push(` 블록 안, `DUPLICATE` 핸들러 뒤에 추가:

```typescript
    vscode.commands.registerCommand(COMMAND_IDS.CHMOD, async (node) => {
      const n = node as { connectionId: string; remotePath: string };

      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const perms = await pickPermissions();
      if (!perms) return;

      await client.chmod(n.remotePath, perms).catch((err) => {
        vscode.window.showErrorMessage(
          vscode.l10n.t('Failed to change permissions: {0}', err instanceof Error ? err.message : String(err)),
        );
      });

      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
    }),
```

- [ ] **Step 2: 빌드 확인**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 3: 전체 테스트 실행**

```bash
cd /Users/addios4u/git/ftpmanager && pnpm --filter ftpmanager test 2>&1 | tail -10
```

Expected: 기존 테스트 모두 통과 (ftp-client.test.ts 12개 실패는 pre-existing, 무관)

- [ ] **Step 4: 커밋**

```bash
cd /Users/addios4u/git/ftpmanager
git add packages/extension/src/extension.ts
git commit -m "feat: add chmod command handler with tree refresh"
```
