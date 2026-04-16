# Search From Folder — Design Spec

**Date:** 2026-04-16  
**Status:** Approved

## Summary

Add the ability to search files starting from a specific remote folder, rather than always starting from the server root. Supports two entry points: (1) right-click context menu on a folder node in the tree view, and (2) a drill-down folder picker as the first step of the existing search command flow.

---

## Architecture

### New File

**`packages/extension/src/services/folder-picker.ts`**  
A reusable service that presents a drill-down Quick Pick UI for selecting a remote folder. Returns the selected path or `undefined` if cancelled.

### Modified Files

| File | Change |
|------|--------|
| `packages/extension/src/extension.ts` | Add `pickRemoteFolder()` call before keyword input; handle directory node context |
| `packages/shared/src/constants.ts` | No new command ID needed — reuse `SEARCH_FILES` |
| `packages/extension/package.json` | Add context menu entry for `viewItem == directory` |
| NLS bundles (`ko`, `ja`, `zh-cn`, `en`) | Add new translation strings |

---

## FolderPickerService

**Signature:**
```typescript
async function pickRemoteFolder(
  client: IFtpClient,
  connectionId: string,
  startPath?: string  // defaults to '/'
): Promise<string | undefined>
```

**Behavior:**

1. Load subdirectories (folders only, no files) of `currentPath` from the remote server.
2. Show a Quick Pick with:
   - `$(check) Search in current folder: /path` — confirms current path and returns it
   - `$(arrow-left) ..` — navigate to parent (hidden at root)
   - `$(folder) folder-name/` — navigate into subfolder
3. On folder selection, update `currentPath` and reload the list (loop, no recursion).
4. On "Search in current folder" selection, return `currentPath`.
5. On ESC / dismiss, return `undefined` (cancels entire search).
6. While loading, set `quickPick.busy = true` and disable items.

---

## Search Command Flow

### Before
```
서버 선택 → 키워드 입력 → 검색 모드 선택 → 검색 실행
```

### After
```
서버 선택 → 폴더 선택(pickRemoteFolder) → 키워드 입력 → 검색 모드 선택 → 검색 실행
```

**Context menu shortcut:**  
When triggered from a directory node (`node.nodeType === 'directory'`), skip the folder picker and use `node.remotePath` directly as the start path.

---

## Context Menu

Add to `package.json` under `contributes.menus["view/item/context"]`:

```json
{
  "command": "ftpmanager.searchFiles",
  "when": "view == ftpmanager && viewItem == directory",
  "group": "navigation"
}
```

No new command ID is needed — the existing `searchFiles` handler detects the node type and branches accordingly.

---

## NLS Strings

New keys to add to all locale bundles (`en`, `ko`, `ja`, `zh-cn`):

| Key | English |
|-----|---------|
| `command.searchFromFolder` | `"Search from here"` |
| `search.selectStartFolder` | `"Select start folder"` |
| `search.searchInCurrentFolder` | `"Search in current folder: {0}"` |
| `search.loadingFolders` | `"Loading folders..."` |

---

## Out of Scope

- Webview UI changes (search remains command-driven)
- Remembering the last searched folder
- Showing files in the folder picker
- Multi-folder search
