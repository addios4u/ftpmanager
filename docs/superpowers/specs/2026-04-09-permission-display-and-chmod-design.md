# Permission Display & Chmod Context Menu — Design Spec

## Goal

트리 뷰에서 파일/폴더의 퍼미션을 표시하고, 우클릭으로 퍼미션을 변경할 수 있도록 한다.

---

## Feature 1: 트리에서 퍼미션 표시

### 동작
- 파일/폴더 아이템 오른쪽에 `(644)` 형식의 설명 텍스트를 표시한다.
- 서버가 권한 정보를 반환하지 않으면 아무것도 표시하지 않는다.
- 권한 변경 후 해당 노드만 refresh하면 즉시 반영된다.

### 구현
- `FtpTreeNode` 인터페이스에 `permissions?: string` 필드 추가
- `mapEntries()` 메서드에서 `entry.permissions`를 노드에 전달
- `getTreeItem()`에서 file/directory 노드에 `item.description = \`(${node.permissions})\`` 설정 (undefined이면 생략)

---

## Feature 2: 우클릭 퍼미션 변경

### 동작
- 파일 또는 폴더 노드에서 우클릭 → "Change Permissions" 메뉴 항목 노출
- 클릭 시 `pickPermissions()` QuickPick 표시 (644, 664, 755, 600, Custom, Skip)
- 선택 후 `client.chmod()` 호출
- 성공 시 해당 노드를 refresh → description이 즉시 갱신됨
- chmod 실패(서버 미지원)는 무시

### 구현
- `package.json`에 `ftpmanager.chmod` 커맨드 등록
- 컨텍스트 메뉴(`view/item/context`)에 file, directory 양쪽에 추가
- `extension.ts`에 커맨드 핸들러 등록:
  1. `pickPermissions()` 호출
  2. `client.chmod(node.remotePath, perms)` 호출 (실패 무시)
  3. `treeProvider.refresh(node)` 호출 → 트리 갱신

---

## 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `packages/extension/src/providers/ftp-tree.ts` | `FtpTreeNode`에 `permissions?` 추가, `mapEntries()`에서 전달, `getTreeItem()`에서 description 설정 |
| `packages/extension/src/extension.ts` | `ftpmanager.chmod` 커맨드 핸들러 등록 |
| `packages/extension/package.json` | 커맨드 등록, 컨텍스트 메뉴 등록 |
| `packages/extension/package.nls.json` | `command.chmod` 타이틀 추가 |
| `packages/extension/l10n/bundle.l10n.json` | i18n 문자열 추가 |

---

## i18n 신규 문자열

### package.nls.json
```json
"command.chmod": "Change Permissions"
```

### bundle.l10n.json
```json
"Change Permissions": "Change Permissions",
"Failed to change permissions: {0}": "Failed to change permissions: {0}"
```

---

## 컨텍스트 메뉴 등록 (package.json)

```json
{
  "command": "ftpmanager.chmod",
  "when": "view == ftpmanager.servers && viewItem =~ /^file$|^directory$/",
  "group": "9_chmod@1"
}
```

file과 directory 양쪽에 동일하게 적용. `group: "9_chmod@1"`으로 기존 메뉴 아이템들과 구분된 섹션에 배치.

---

## 에러 처리

- `chmod` 실패는 `.catch(() => {})` — 서버 미지원 시 조용히 무시
- 연결 없을 때는 에러 메시지 표시 후 조기 종료 (기존 패턴 동일)
