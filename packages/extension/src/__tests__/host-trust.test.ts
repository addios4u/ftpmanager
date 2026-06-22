import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { HostTrustStore, createHostKeyVerifier, type HostKeyInfo } from '../services/host-trust.js';

function makeContext(): vscode.ExtensionContext {
  const data: Record<string, unknown> = {};
  return {
    globalState: {
      get: vi.fn((key: string, def?: unknown) => (key in data ? data[key] : def)),
      update: vi.fn(async (key: string, value: unknown) => { data[key] = value; }),
    },
  } as unknown as vscode.ExtensionContext;
}

function info(overrides: Partial<HostKeyInfo> = {}): HostKeyInfo {
  return {
    connectionId: 'c1',
    host: 'example.com',
    port: 22,
    protocol: 'sftp',
    fingerprint: 'SHA256:AAA',
    algo: 'SSH host key',
    ...overrides,
  };
}

describe('HostTrustStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores, reads and removes entries', async () => {
    const store = new HostTrustStore(makeContext());
    expect(store.get('c1')).toBeUndefined();
    await store.set('c1', { host: 'h', port: 22, protocol: 'sftp', fingerprint: 'fp' });
    expect(store.get('c1')).toMatchObject({ fingerprint: 'fp' });
    await store.remove('c1');
    expect(store.get('c1')).toBeUndefined();
  });
});

describe('createHostKeyVerifier', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prompts on first use and stores the fingerprint when trusted', async () => {
    const store = new HostTrustStore(makeContext());
    const verify = createHostKeyVerifier(store);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Trust & Connect' as never);

    const ok = await verify(info());

    expect(ok).toBe(true);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(store.get('c1')).toMatchObject({ fingerprint: 'SHA256:AAA' });
  });

  it('rejects and does not store when the first-use prompt is cancelled', async () => {
    const store = new HostTrustStore(makeContext());
    const verify = createHostKeyVerifier(store);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as never);

    const ok = await verify(info());

    expect(ok).toBe(false);
    expect(store.get('c1')).toBeUndefined();
  });

  it('accepts a known matching fingerprint without prompting', async () => {
    const store = new HostTrustStore(makeContext());
    await store.set('c1', { host: 'example.com', port: 22, protocol: 'sftp', fingerprint: 'SHA256:AAA' });
    const verify = createHostKeyVerifier(store);

    const ok = await verify(info());

    expect(ok).toBe(true);
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns on a changed fingerprint and keeps the old one when cancelled', async () => {
    const store = new HostTrustStore(makeContext());
    await store.set('c1', { host: 'example.com', port: 22, protocol: 'sftp', fingerprint: 'SHA256:OLD' });
    const verify = createHostKeyVerifier(store);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce(undefined as never);

    const ok = await verify(info({ fingerprint: 'SHA256:NEW' }));

    expect(ok).toBe(false);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(store.get('c1')).toMatchObject({ fingerprint: 'SHA256:OLD' });
  });

  it('updates the stored fingerprint when a changed key is explicitly accepted', async () => {
    const store = new HostTrustStore(makeContext());
    await store.set('c1', { host: 'example.com', port: 22, protocol: 'sftp', fingerprint: 'SHA256:OLD' });
    const verify = createHostKeyVerifier(store);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Connect Anyway' as never);

    const ok = await verify(info({ fingerprint: 'SHA256:NEW' }));

    expect(ok).toBe(true);
    expect(store.get('c1')).toMatchObject({ fingerprint: 'SHA256:NEW' });
  });

  it('re-prompts (TOFU) when the endpoint changed for the same connection id', async () => {
    const store = new HostTrustStore(makeContext());
    await store.set('c1', { host: 'old.example.com', port: 22, protocol: 'sftp', fingerprint: 'SHA256:AAA' });
    const verify = createHostKeyVerifier(store);
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValueOnce('Trust & Connect' as never);

    const ok = await verify(info({ host: 'new.example.com', fingerprint: 'SHA256:AAA' }));

    expect(ok).toBe(true);
    expect(vscode.window.showWarningMessage).toHaveBeenCalledOnce();
    expect(store.get('c1')).toMatchObject({ host: 'new.example.com' });
  });
});
