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
