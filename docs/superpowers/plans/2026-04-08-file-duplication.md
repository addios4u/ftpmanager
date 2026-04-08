# File Duplication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Duplicate" context menu command that copies a remote file or folder within the same parent directory, naming it with a `_copy` suffix and auto-incrementing on conflicts.

**Architecture:** A pure `getUniqueCopyName` utility handles naming; the command handler downloads to a UUID-named OS temp directory, uploads to the new remote path, and cleans up in a `finally` block. Both clients implement the same `IFtpClient` interface so no client-specific branching is needed beyond what's already there.

**Tech Stack:** TypeScript, VSCode extension API, `basic-ftp` (FTP), `ssh2-sftp-client` (SFTP), Node.js `fs/promises`, `os`, `crypto`

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/extension/src/utils/duplicate.ts` | Pure `getUniqueCopyName` function |
| Create | `packages/extension/src/__tests__/duplicate-utils.test.ts` | Unit tests for naming logic |
| Modify | `packages/shared/src/constants.ts` | Add `DUPLICATE` to `COMMAND_IDS` |
| Modify | `packages/extension/src/extension.ts` | Add imports + register command handler |
| Modify | `packages/extension/package.json` | Command definition + context menu entry |
| Modify | `packages/extension/l10n/bundle.l10n.json` | Runtime i18n strings |
| Modify | `packages/extension/package.nls.json` | EN command title |
| Modify | `packages/extension/package.nls.ko.json` | KO command title |
| Modify | `packages/extension/package.nls.ja.json` | JA command title |
| Modify | `packages/extension/package.nls.zh-cn.json` | ZH command title |

---

## Task 1: Add DUPLICATE to shared COMMAND_IDS

**Files:**
- Modify: `packages/shared/src/constants.ts`

- [ ] **Step 1: Add the constant**

In `packages/shared/src/constants.ts`, add `DUPLICATE` after `SEARCH_FILES`:

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
} as const;
```

- [ ] **Step 2: Build shared**

```bash
pnpm --filter @ftpmanager/shared build
```

Expected: no errors, `packages/shared/dist/` updated.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/constants.ts
git commit -m "feat: add DUPLICATE to shared COMMAND_IDS"
```

---

## Task 2: Write failing unit tests for getUniqueCopyName

**Files:**
- Create: `packages/extension/src/utils/duplicate.ts` (stub only)
- Create: `packages/extension/src/__tests__/duplicate-utils.test.ts`

- [ ] **Step 1: Create stub file so the import resolves**

Create `packages/extension/src/utils/duplicate.ts` with only the export signature:

```typescript
import * as path from 'path';

export function getUniqueCopyName(_originalName: string, _existingNames: string[]): string {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write the tests**

Create `packages/extension/src/__tests__/duplicate-utils.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getUniqueCopyName } from '../utils/duplicate.js';

describe('getUniqueCopyName', () => {
  it('appends _copy before the extension', () => {
    expect(getUniqueCopyName('report.txt', [])).toBe('report_copy.txt');
  });

  it('appends _copy to a folder name (no extension)', () => {
    expect(getUniqueCopyName('images', [])).toBe('images_copy');
  });

  it('increments to _copy_2 when _copy already exists', () => {
    expect(getUniqueCopyName('report.txt', ['report_copy.txt'])).toBe('report_copy_2.txt');
  });

  it('increments further when multiple copies exist', () => {
    const existing = ['report_copy.txt', 'report_copy_2.txt', 'report_copy_3.txt'];
    expect(getUniqueCopyName('report.txt', existing)).toBe('report_copy_4.txt');
  });

  it('handles extension-less files like Makefile', () => {
    expect(getUniqueCopyName('Makefile', [])).toBe('Makefile_copy');
  });

  it('uses only the final extension for multi-dot filenames', () => {
    // path.extname('archive.tar.gz') === '.gz'
    expect(getUniqueCopyName('archive.tar.gz', [])).toBe('archive.tar_copy.gz');
  });

  it('returns _copy when existing list has unrelated names', () => {
    expect(getUniqueCopyName('data.json', ['readme.md', 'config.json'])).toBe('data_copy.json');
  });
});
```

- [ ] **Step 3: Run tests and confirm they fail**

```bash
pnpm --filter ftpmanager test -- duplicate-utils
```

Expected output: 7 tests FAIL with `Error: not implemented`

---

## Task 3: Implement getUniqueCopyName and verify tests pass

**Files:**
- Modify: `packages/extension/src/utils/duplicate.ts`

- [ ] **Step 1: Implement the function**

Replace the stub in `packages/extension/src/utils/duplicate.ts` with:

```typescript
import * as path from 'path';

/**
 * Returns a unique copy name for a remote file or directory.
 *
 * Examples:
 *   "report.txt"   → "report_copy.txt"   → "report_copy_2.txt" ...
 *   "images"       → "images_copy"        → "images_copy_2" ...
 *   "archive.tar.gz" → "archive.tar_copy.gz"
 */
export function getUniqueCopyName(originalName: string, existingNames: string[]): string {
  const existing = new Set(existingNames);
  const ext = path.extname(originalName);
  const base = ext ? originalName.slice(0, -ext.length) : originalName;

  const first = `${base}_copy${ext}`;
  if (!existing.has(first)) return first;

  let n = 2;
  while (true) {
    const candidate = `${base}_copy_${n}${ext}`;
    if (!existing.has(candidate)) return candidate;
    n++;
  }
}
```

- [ ] **Step 2: Run tests and confirm they all pass**

```bash
pnpm --filter ftpmanager test -- duplicate-utils
```

Expected output: `7 tests passed`

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/utils/duplicate.ts packages/extension/src/__tests__/duplicate-utils.test.ts
git commit -m "feat: implement getUniqueCopyName with unit tests"
```

---

## Task 4: Add i18n strings to all localization files

**Files:**
- Modify: `packages/extension/l10n/bundle.l10n.json`
- Modify: `packages/extension/package.nls.json`
- Modify: `packages/extension/package.nls.ko.json`
- Modify: `packages/extension/package.nls.ja.json`
- Modify: `packages/extension/package.nls.zh-cn.json`

- [ ] **Step 1: Add runtime strings to bundle.l10n.json**

In `packages/extension/l10n/bundle.l10n.json`, add before the closing `}`:

```json
  "Duplicating: {0}": "Duplicating: {0}",
  "Downloading...": "Downloading...",
  "Uploading...": "Uploading...",
  "Duplicated to: {0}": "Duplicated to: {0}",
  "Failed to duplicate: {0}": "Failed to duplicate: {0}"
```

- [ ] **Step 2: Add EN command title to package.nls.json**

In `packages/extension/package.nls.json`, add after `"command.searchFiles"`:

```json
  "command.duplicate": "Duplicate"
```

- [ ] **Step 3: Add KO command title to package.nls.ko.json**

In `packages/extension/package.nls.ko.json`, add after `"command.searchFiles"`:

```json
  "command.duplicate": "복제"
```

- [ ] **Step 4: Add JA command title to package.nls.ja.json**

In `packages/extension/package.nls.ja.json`, add after `"command.searchFiles"`:

```json
  "command.duplicate": "複製"
```

- [ ] **Step 5: Add ZH command title to package.nls.zh-cn.json**

In `packages/extension/package.nls.zh-cn.json`, add after `"command.searchFiles"`:

```json
  "command.duplicate": "复制"
```

- [ ] **Step 6: Commit**

```bash
git add packages/extension/l10n/bundle.l10n.json \
        packages/extension/package.nls.json \
        packages/extension/package.nls.ko.json \
        packages/extension/package.nls.ja.json \
        packages/extension/package.nls.zh-cn.json
git commit -m "feat: add duplicate command i18n strings"
```

---

## Task 5: Register command definition and context menu in package.json

**Files:**
- Modify: `packages/extension/package.json`

- [ ] **Step 1: Add command definition**

In `packages/extension/package.json`, in the `contributes.commands` array, add after the `ftpmanager.deleteRemote` entry (around line 116):

```json
      {
        "command": "ftpmanager.duplicate",
        "title": "%command.duplicate%",
        "category": "%category.ftpManager%"
      },
```

- [ ] **Step 2: Add context menu entry**

In `packages/extension/package.json`, in `contributes.menus["view/item/context"]`, add after the `ftpmanager.rename` entry (around line 228):

```json
        {
          "command": "ftpmanager.duplicate",
          "when": "view == ftpmanager.servers && viewItem =~ /^file$|^directory$/",
          "group": "3_edit@1.5"
        },
```

This places "Duplicate" between "Rename" (`3_edit@1`) and "Delete" (`3_edit@2`).

- [ ] **Step 3: Commit**

```bash
git add packages/extension/package.json
git commit -m "feat: register duplicate command and context menu entry"
```

---

## Task 6: Implement duplicate command handler in extension.ts

**Files:**
- Modify: `packages/extension/src/extension.ts`

- [ ] **Step 1: Add imports**

At the top of `packages/extension/src/extension.ts`, after the existing imports (around line 9), add:

```typescript
import * as os from 'os';
import * as fs from 'fs/promises';
import { randomUUID } from 'crypto';
import { getUniqueCopyName } from './utils/duplicate.js';
```

- [ ] **Step 2: Register the command handler**

In `packages/extension/src/extension.ts`, inside the `context.subscriptions.push(...)` block, add the following after the `COPY_REMOTE_PATH` handler (around line 334):

```typescript
    vscode.commands.registerCommand(COMMAND_IDS.DUPLICATE, async (node) => {
      const n = node as { connectionId: string; remotePath: string; nodeType: string; label: string };
      const client = connectionManager.getClient(n.connectionId);
      if (!client) {
        vscode.window.showErrorMessage(vscode.l10n.t('No active connection'));
        return;
      }

      const parentDir = n.remotePath.substring(0, n.remotePath.lastIndexOf('/')) || '/';
      const baseName = n.remotePath.substring(n.remotePath.lastIndexOf('/') + 1);

      const entries = await client.list(parentDir);
      const existingNames = entries.map((e) => e.name);
      const newName = getUniqueCopyName(baseName, existingNames);
      const destPath = parentDir === '/' ? `/${newName}` : `${parentDir}/${newName}`;

      const tmpBase = path.join(os.tmpdir(), `ftpmanager-${randomUUID()}`);
      const tmpPath = path.join(tmpBase, baseName);

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: vscode.l10n.t('Duplicating: {0}', baseName),
          cancellable: false,
        },
        async (progress) => {
          try {
            await fs.mkdir(tmpBase, { recursive: true });

            if (n.nodeType === 'file') {
              await client.downloadFile(n.remotePath, tmpPath);
              await client.uploadFile(tmpPath, destPath);
            } else {
              progress.report({ message: vscode.l10n.t('Downloading...') });
              await client.downloadFolder(n.remotePath, tmpPath);
              progress.report({ message: vscode.l10n.t('Uploading...') });
              await client.uploadFolder(tmpPath, destPath);
            }

            vscode.window.showInformationMessage(vscode.l10n.t('Duplicated to: {0}', newName));
          } catch (err) {
            vscode.window.showErrorMessage(vscode.l10n.t('Failed to duplicate: {0}', String(err)));
            try {
              if (n.nodeType === 'file') {
                await client.delete(destPath);
              } else {
                await client.rmdir(destPath, true);
              }
            } catch {
              // best-effort cleanup of partial remote destination
            }
          } finally {
            await fs.rm(tmpBase, { recursive: true, force: true });
          }
        },
      );

      treeProvider.refresh();
    }),
```

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/extension.ts packages/extension/src/utils/duplicate.ts
git commit -m "feat: implement duplicate command handler"
```

---

## Task 7: Build and verify

**Files:** (no changes)

- [ ] **Step 1: Run full test suite**

```bash
pnpm --filter ftpmanager test
```

Expected: all existing tests pass, plus 7 new duplicate-utils tests pass.

- [ ] **Step 2: Build the extension**

```bash
pnpm run build
```

Expected: no TypeScript errors, `packages/extension/dist/extension.js` updated.

- [ ] **Step 3: Verify TypeScript types**

```bash
pnpm --filter ftpmanager exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Final commit (if any fixes were needed)**

If steps 1-3 required any adjustments, commit them:

```bash
git add -p
git commit -m "fix: address build issues in duplicate implementation"
```
