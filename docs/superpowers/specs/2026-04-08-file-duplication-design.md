# File Duplication Feature — Design Spec

**Date:** 2026-04-08  
**Status:** Approved  

---

## Overview

Add a **Duplicate** command to the FTP Manager extension that allows users to duplicate a remote file or folder within the same parent directory. The duplicated item is named with a `_copy` suffix (e.g., `report_copy.txt`), incrementing to `_copy_2`, `_copy_3`, etc. when conflicts exist.

---

## Scope

- Works for both **files** and **folders** (recursive)
- Available via right-click context menu on any `file` or `directory` tree item
- No user input required — naming is automatic
- Progress notification shown during operation (indeterminate, non-cancellable)
- Fully localized (English + Korean)

---

## Files Changed

| File | Change |
|------|--------|
| `packages/extension/package.json` | Add `ftpmanager.duplicate` command definition + context menu entry |
| `packages/extension/src/extension.ts` | Register `ftpmanager.duplicate` command handler |
| `packages/extension/bundle.l10n.json` | Add English i18n strings |
| `packages/extension/package.nls.json` | Add English NLS strings for command title |
| `packages/extension/package.nls.ko.json` | Add Korean NLS strings for command title |

No new files, no interface changes to `IFtpClient`.

---

## Command Flow

```
User right-clicks file or folder → "Duplicate"
  ↓
1. Determine parent directory path
2. list(parentDir) → collect existing item names
3. Compute unique copy name (see Naming Logic)
4. vscode.window.withProgress(Notification, non-cancellable)
   ├── [file]   downloadFile(src, tmpPath) → uploadFile(tmpPath, destPath)
   └── [folder] downloadFolder(src, tmpDir) → uploadFolder(tmpDir, destPath)
5. fs.rm(tmpPath/tmpDir, { recursive: true }) in finally block
6. ftpTreeProvider.refresh()
7. showInformationMessage("Duplicated to: {destName}")
```

---

## Naming Logic

**Algorithm:**
1. Call `list(parentDir)` to get existing names
2. Compute candidate name:
   - **File:** split extension → `{base}_copy{.ext}`
   - **Folder:** `{name}_copy`
3. If candidate exists in listing, increment: `_copy_2`, `_copy_3`, ...
4. Return first non-conflicting name

**Examples:**

| Original | 1st Copy | 2nd Copy |
|----------|----------|----------|
| `report.txt` | `report_copy.txt` | `report_copy_2.txt` |
| `images/` | `images_copy/` | `images_copy_2/` |
| `archive.tar.gz` | `archive.tar_copy.gz` | `archive.tar_copy_2.gz` |

> Note: For `archive.tar.gz`, only the final extension (`.gz`) is treated as the extension. `path.extname()` behavior.

---

## Progress Display

Uses `vscode.window.withProgress` with `ProgressLocation.Notification`, `cancellable: false`.

| Stage | Message |
|-------|---------|
| File duplication | `"Duplicating file: {filename}"` |
| Folder — downloading | `"Duplicating folder: {name} (downloading...)"` |
| Folder — uploading | `"Duplicating folder: {name} (uploading...)"` |
| Success (toast) | `"Duplicated to: {newName}"` |
| Error (toast) | `"Failed to duplicate: {errorMessage}"` |

---

## Error Handling

- Temp file/folder is always deleted via `try/finally` (guaranteed cleanup)
- On upload failure after partial upload: best-effort deletion of the partial remote destination via `delete()` / `rmdir()`
- All errors surface as `vscode.window.showErrorMessage`

---

## Localization Keys

### `bundle.l10n.json` (runtime strings)

```json
"duplicate.progress.file": "Duplicating file: {0}",
"duplicate.progress.folder.download": "Duplicating folder: {0} (downloading...)",
"duplicate.progress.folder.upload": "Duplicating folder: {0} (uploading...)",
"duplicate.success": "Duplicated to: {0}",
"duplicate.error": "Failed to duplicate: {0}"
```

### `package.nls.json` / `package.nls.ko.json` (command title)

| Key | English | Korean |
|-----|---------|--------|
| `command.duplicate` | `Duplicate` | `복제` |

---

## Context Menu Placement

Added to group `3_edit` (alongside Rename and Delete) in `packages/extension/package.json`:

```json
{
  "command": "ftpmanager.duplicate",
  "when": "viewItem =~ /^file$|^directory$/",
  "group": "3_edit@1.5"
}
```

This places **Duplicate** between Rename (`@1`) and Delete (`@2`).

---

## Temp Directory Strategy

```
os.tmpdir() / ftpmanager-<randomUUID> / <originalName>
```

- UUID per operation prevents collisions from concurrent duplications
- Deleted in `finally` regardless of success or failure

---

## Out of Scope

- Cancellation mid-operation (temp file cleanup complexity outweighs benefit)
- Cross-directory duplication (copy to different parent)
- Per-file progress tracking within folder duplication (reuses `downloadFolder`/`uploadFolder` black-box)
- Server-side copy optimization (neither FTP nor SFTP protocol supports native copy)
