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
