# File Permissions on Create & Upload — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 새 파일 생성 및 업로드 시 QuickPick으로 권한(permissions)을 선택해 chmod를 적용한다.

**Architecture:** 공통 QuickPick 헬퍼 `pickPermissions()`를 `utils/pick-permissions.ts`로 분리하고, `extension.ts`의 NEW_FILE·UPLOAD_FILE 커맨드와 `ftp-tree.ts`의 handleDrop에서 호출한다. 편집 후 저장은 이미 원래 권한을 복원하므로 변경하지 않는다.

**Tech Stack:** TypeScript, VSCode Extension API (`vscode.window.showQuickPick`, `vscode.window.showInputBox`, `vscode.l10n.t`), 기존 `IFtpClient.chmod()`

---

## 파일 구조

| 파일 | 작업 |
|------|------|
| `packages/extension/src/utils/pick-permissions.ts` | 신규 — QuickPick 헬퍼 |
| `packages/extension/src/__tests__/pick-permissions.test.ts` | 신규 — 유닛 테스트 |
| `packages/extension/src/extension.ts` | 수정 — NEW_FILE, UPLOAD_FILE, sendFileToServer 커맨드 |
| `packages/extension/src/providers/ftp-tree.ts` | 수정 — handleDrop |
| `packages/extension/l10n/bundle.l10n.json` | 수정 — 신규 i18n 문자열 추가 |

---

## Task 1: `pickPermissions()` 헬퍼 구현

**Files:**
- Create: `packages/extension/src/utils/pick-permissions.ts`
- Create: `packages/extension/src/__tests__/pick-permissions.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`packages/extension/src/__tests__/pick-permissions.test.ts`를 생성:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';

// vscode mock은 src/__mocks__/vscode.ts에서 자동 로드됨
vi.mock('vscode');

describe('pickPermissions()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns selected preset value', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: '644', description: 'rw-r--r--', value: '644' } as any,
    );
    const { pickPermissions } = await import('../utils/pick-permissions.js');
    const result = await pickPermissions();
    expect(result).toBe('644');
  });

  it('returns undefined when Skip is selected', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Skip (use server default)', value: undefined } as any,
    );
    const { pickPermissions } = await import('../utils/pick-permissions.js');
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });

  it('returns undefined when QuickPick is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
    const { pickPermissions } = await import('../utils/pick-permissions.js');
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });

  it('shows InputBox and returns custom value when Custom is selected', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Custom...', value: 'custom' } as any,
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('600');
    const { pickPermissions } = await import('../utils/pick-permissions.js');
    const result = await pickPermissions();
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBe('600');
  });

  it('returns undefined when Custom InputBox is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Custom...', value: 'custom' } as any,
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    const { pickPermissions } = await import('../utils/pick-permissions.js');
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 — 실패 확인**

```bash
pnpm --filter ftpmanager test -- --reporter=verbose pick-permissions
```

Expected: FAIL with "Cannot find module '../utils/pick-permissions.js'"

- [ ] **Step 3: 헬퍼 구현**

`packages/extension/src/utils/pick-permissions.ts`를 생성:

```typescript
import * as vscode from 'vscode';

interface PermissionItem extends vscode.QuickPickItem {
  value: string | undefined;
}

const PRESETS: PermissionItem[] = [
  {
    label: '644',
    description: vscode.l10n.t('Default file'),
    detail: 'rw-r--r--',
    value: '644',
  },
  {
    label: '664',
    description: vscode.l10n.t('Group writable'),
    detail: 'rw-rw-r--',
    value: '664',
  },
  {
    label: '755',
    description: vscode.l10n.t('Executable script'),
    detail: 'rwxr-xr-x',
    value: '755',
  },
  {
    label: '600',
    description: vscode.l10n.t('Private file'),
    detail: 'rw-------',
    value: '600',
  },
  {
    label: '',
    kind: vscode.QuickPickItemKind.Separator,
    value: undefined,
  },
  {
    label: vscode.l10n.t('Custom...'),
    value: 'custom',
  },
  {
    label: vscode.l10n.t('Skip (use server default)'),
    value: undefined,
  },
];

/**
 * 권한 선택 QuickPick을 표시한다.
 * @returns 선택된 권한 문자열 (예: "644"), Skip/취소 시 undefined
 */
export async function pickPermissions(): Promise<string | undefined> {
  const picked = await vscode.window.showQuickPick(PRESETS, {
    title: vscode.l10n.t('Select file permissions'),
    placeHolder: vscode.l10n.t('Select file permissions'),
    ignoreFocusOut: true,
  });

  if (!picked) return undefined;
  if (picked.value === undefined) return undefined;

  if (picked.value === 'custom') {
    const custom = await vscode.window.showInputBox({
      title: vscode.l10n.t('Custom permissions'),
      prompt: vscode.l10n.t('Enter permissions (e.g. 644)'),
      placeHolder: '644',
      ignoreFocusOut: true,
      validateInput: (v) =>
        /^\d{3,4}$/.test(v.trim()) ? null : vscode.l10n.t('Enter 3 or 4 digits (e.g. 644, 0644)'),
    });
    return custom?.trim() || undefined;
  }

  return picked.value;
}
```

- [ ] **Step 4: 테스트 실행 — 통과 확인**

```bash
pnpm --filter ftpmanager test -- --reporter=verbose pick-permissions
```

Expected: 5 tests PASS

- [ ] **Step 5: i18n 문자열 추가**

`packages/extension/l10n/bundle.l10n.json`에 다음 항목 추가 (마지막 `}` 앞):

```json
  "Select file permissions": "Select file permissions",
  "Default file": "Default file",
  "Group writable": "Group writable",
  "Executable script": "Executable script",
  "Private file": "Private file",
  "Custom...": "Custom...",
  "Skip (use server default)": "Skip (use server default)",
  "Custom permissions": "Custom permissions",
  "Enter permissions (e.g. 644)": "Enter permissions (e.g. 644)",
  "Enter 3 or 4 digits (e.g. 644, 0644)": "Enter 3 or 4 digits (e.g. 644, 0644)"
```

- [ ] **Step 6: 커밋**

```bash
git add packages/extension/src/utils/pick-permissions.ts \
        packages/extension/src/__tests__/pick-permissions.test.ts \
        packages/extension/l10n/bundle.l10n.json
git commit -m "feat: add pickPermissions() QuickPick helper with i18n"
```

---

## Task 2: NEW_FILE 커맨드에 권한 적용

**Files:**
- Modify: `packages/extension/src/extension.ts:262-287`

현재 코드:
```typescript
await client.putContent(Buffer.alloc(0), newPath);
treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
```

- [ ] **Step 1: extension.ts import에 pickPermissions 추가**

파일 상단 import 목록에 추가:
```typescript
import { pickPermissions } from './utils/pick-permissions.js';
```

- [ ] **Step 2: NEW_FILE 커맨드 수정**

`extension.ts`의 `COMMAND_IDS.NEW_FILE` 블록에서 `putContent` 이후 부분을 다음으로 교체:

```typescript
      await client.putContent(Buffer.alloc(0), newPath);

      const perms = await pickPermissions();
      if (perms) {
        await client.chmod(newPath, perms).catch(() => {});
      }

      treeProvider.refresh(node as Parameters<typeof treeProvider.refresh>[0]);
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 4: 커밋**

```bash
git add packages/extension/src/extension.ts
git commit -m "feat: apply permissions after new file creation"
```

---

## Task 3: UPLOAD_FILE 커맨드에 권한 적용

**Files:**
- Modify: `packages/extension/src/extension.ts:144-178` (UPLOAD_FILE 커맨드)

현재 코드 (업로드 루프):
```typescript
      await vscode.window.withProgress(
        { ... },
        async (progress) => {
          for (const file of files) {
            const fileName = path.basename(file.fsPath);
            progress.report({ message: fileName });
            const remoteDest = n.remotePath.endsWith('/')
              ? n.remotePath + fileName
              : n.remotePath + '/' + fileName;
            await client.uploadFile(file.fsPath, remoteDest);
          }
        },
      );
```

- [ ] **Step 1: UPLOAD_FILE 커맨드에 pickPermissions 추가**

`files` 확인 후, `client` 확인 후, `withProgress` 호출 전에 다음 삽입:

```typescript
      const perms = await pickPermissions();
```

업로드 루프 내 `uploadFile` 이후에 chmod 추가:

```typescript
            await client.uploadFile(file.fsPath, remoteDest);
            if (perms) {
              await client.chmod(remoteDest, perms).catch(() => {});
            }
```

전체 수정 결과:
```typescript
      const perms = await pickPermissions();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Upload File'),
          cancellable: false,
        },
        async (progress) => {
          for (const file of files) {
            const fileName = path.basename(file.fsPath);
            progress.report({ message: fileName });
            const remoteDest = n.remotePath.endsWith('/')
              ? n.remotePath + fileName
              : n.remotePath + '/' + fileName;
            await client.uploadFile(file.fsPath, remoteDest);
            if (perms) {
              await client.chmod(remoteDest, perms).catch(() => {});
            }
          }
        },
      );
```

- [ ] **Step 2: sendFileToServer 커맨드도 동일하게 수정** (`extension.ts:536-546` 근처)

`sendFileToServer`의 `withProgress` 블록:
```typescript
      const perms = await pickPermissions();

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${fileName}`,
          cancellable: false,
        },
        async () => {
          await client.uploadFile(uri.fsPath, remoteDest);
          if (perms) {
            await client.chmod(remoteDest, perms).catch(() => {});
          }
        },
      );
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 4: 커밋**

```bash
git add packages/extension/src/extension.ts
git commit -m "feat: apply permissions after file upload (command)"
```

---

## Task 4: handleDrop (드래그&드롭 업로드)에 권한 적용

**Files:**
- Modify: `packages/extension/src/providers/ftp-tree.ts:340-371`

현재 코드:
```typescript
    const uploadDir = target.remotePath;
    const total = localPaths.length;

    await vscode.window.withProgress(
      { ... },
      async (progress) => {
        for (let i = 0; i < localPaths.length; i++) {
          ...
          await client.uploadFile(localPath, remoteDest);
        }
      },
    );
```

- [ ] **Step 1: ftp-tree.ts import에 pickPermissions 추가**

파일 상단 import에 추가:
```typescript
import { pickPermissions } from '../utils/pick-permissions.js';
```

- [ ] **Step 2: handleDrop에 pickPermissions 삽입**

`const total = localPaths.length;` 이후, `withProgress` 전에 삽입:

```typescript
    const perms = await pickPermissions();
```

업로드 루프 내 `uploadFile` 이후 chmod 추가:

```typescript
          await client.uploadFile(localPath, remoteDest);
          if (perms) {
            await client.chmod(remoteDest, perms).catch(() => {});
          }
```

전체 수정 결과 (해당 블록):
```typescript
    const uploadDir = target.remotePath;
    const total = localPaths.length;

    const perms = await pickPermissions();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: vscode.l10n.t('Uploading {0} file(s)...', total),
        cancellable: false,
      },
      async (progress) => {
        for (let i = 0; i < localPaths.length; i++) {
          const localPath = localPaths[i];
          const fileName = path.basename(localPath);
          progress.report({ message: `${i + 1}/${total}: ${fileName}` });
          const remoteDest = uploadDir.endsWith('/') ? uploadDir + fileName : uploadDir + '/' + fileName;
          await client.uploadFile(localPath, remoteDest);
          if (perms) {
            await client.chmod(remoteDest, perms).catch(() => {});
          }
        }
      },
    );
```

- [ ] **Step 3: 빌드 확인**

```bash
pnpm --filter ftpmanager build
```

Expected: 에러 없이 완료

- [ ] **Step 4: 전체 테스트 실행**

```bash
pnpm --filter ftpmanager test
```

Expected: 전체 테스트 PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/extension/src/providers/ftp-tree.ts
git commit -m "feat: apply permissions after drag-and-drop upload"
```
