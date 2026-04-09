import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { pickPermissions } from '../utils/pick-permissions.js';

describe('pickPermissions()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns selected preset value', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: '644', description: 'rw-r--r--', value: '644' } as any,
    );
    const result = await pickPermissions();
    expect(result).toBe('644');
  });

  it('returns undefined when Skip is selected', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Skip (use server default)', value: undefined } as any,
    );
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });

  it('returns undefined when QuickPick is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });

  it('shows InputBox and returns custom value when Custom is selected', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Custom...', value: 'custom' } as any,
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('600');
    const result = await pickPermissions();
    expect(vscode.window.showInputBox).toHaveBeenCalled();
    expect(result).toBe('600');
  });

  it('returns undefined when Custom InputBox is cancelled', async () => {
    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(
      { label: 'Custom...', value: 'custom' } as any,
    );
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);
    const result = await pickPermissions();
    expect(result).toBeUndefined();
  });
});
