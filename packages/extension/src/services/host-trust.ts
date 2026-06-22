import * as vscode from 'vscode';

/**
 * TOFU (Trust On First Use) host verification for SFTP host keys and FTPS
 * certificates.
 *
 * SFTP and FTPS connections were previously established without verifying the
 * server's identity (ssh2 had no `hostVerifier`, and FTPS used
 * `rejectUnauthorized: false`). That left both protocols open to
 * man-in-the-middle attacks. We now pin the server's fingerprint on first
 * connect and warn loudly if it ever changes — the same model used by OpenSSH
 * (`known_hosts`) and FileZilla.
 */

const TRUSTED_HOST_KEYS = 'ftpmanager.trustedHostKeys';

export interface HostKeyInfo {
  /** Connection id the fingerprint is pinned against. */
  connectionId: string;
  host: string;
  port: number;
  protocol: 'ftps' | 'sftp';
  /** Human-readable fingerprint, e.g. `SHA256:abc…` or `AA:BB:CC…`. */
  fingerprint: string;
  /** Algorithm/label shown to the user (e.g. "SSH host key", "Certificate (SHA-256)"). */
  algo?: string;
}

interface TrustedEntry {
  host: string;
  port: number;
  protocol: 'ftps' | 'sftp';
  fingerprint: string;
  algo?: string;
}

/** Resolves to `true` to accept the connection, `false` to reject it. */
export type HostKeyVerifier = (info: HostKeyInfo) => Promise<boolean>;

/** Persists trusted host fingerprints in the extension's global state. */
export class HostTrustStore {
  constructor(private readonly context: vscode.ExtensionContext) {}

  private all(): Record<string, TrustedEntry> {
    return this.context.globalState.get<Record<string, TrustedEntry>>(TRUSTED_HOST_KEYS, {});
  }

  get(connectionId: string): TrustedEntry | undefined {
    return this.all()[connectionId];
  }

  async set(connectionId: string, entry: TrustedEntry): Promise<void> {
    await this.context.globalState.update(TRUSTED_HOST_KEYS, { ...this.all(), [connectionId]: entry });
  }

  async remove(connectionId: string): Promise<void> {
    const all = { ...this.all() };
    if (!(connectionId in all)) return;
    delete all[connectionId];
    await this.context.globalState.update(TRUSTED_HOST_KEYS, all);
  }
}

/**
 * Builds a verifier backed by `store`. On an unknown or changed fingerprint it
 * shows a modal prompt; the user's decision (and the new fingerprint) is
 * persisted only when they explicitly choose to trust.
 */
export function createHostKeyVerifier(store: HostTrustStore): HostKeyVerifier {
  return async (info) => {
    const entry: TrustedEntry = {
      host: info.host,
      port: info.port,
      protocol: info.protocol,
      fingerprint: info.fingerprint,
      algo: info.algo,
    };
    const stored = store.get(info.connectionId);
    const sameEndpoint =
      !!stored &&
      stored.host === info.host &&
      stored.port === info.port &&
      stored.protocol === info.protocol;

    // Known and unchanged → accept silently.
    if (sameEndpoint && stored!.fingerprint === info.fingerprint) {
      return true;
    }

    const algoLabel = info.algo ?? (info.protocol === 'sftp' ? 'SSH host key' : 'Certificate');

    // Known endpoint but the fingerprint changed → possible MITM. Warn hard.
    if (sameEndpoint && stored!.fingerprint !== info.fingerprint) {
      const connectAnyway = vscode.l10n.t('Connect Anyway');
      const choice = await vscode.window.showWarningMessage(
        vscode.l10n.t('Host identity changed for "{0}:{1}"', info.host, String(info.port)),
        {
          modal: true,
          detail: vscode.l10n.t(
            'The {0} fingerprint does not match the one you previously trusted. This may mean the server was reconfigured — or that someone is intercepting the connection (man-in-the-middle attack).\n\nPreviously trusted:\n{1}\n\nNow presented:\n{2}\n\nOnly continue if you understand why it changed.',
            algoLabel,
            stored!.fingerprint,
            info.fingerprint,
          ),
        },
        connectAnyway,
      );
      if (choice === connectAnyway) {
        await store.set(info.connectionId, entry);
        return true;
      }
      return false;
    }

    // First time seeing this endpoint → TOFU prompt.
    const trust = vscode.l10n.t('Trust & Connect');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('Trust the identity of "{0}:{1}"?', info.host, String(info.port)),
      {
        modal: true,
        detail: vscode.l10n.t(
          'This is the first time FTPManager is connecting to this server, so its identity cannot be verified automatically.\n\n{0} fingerprint:\n{1}\n\nOnly continue if this fingerprint matches what you expect from the server administrator.',
          algoLabel,
          info.fingerprint,
        ),
      },
      trust,
    );
    if (choice === trust) {
      await store.set(info.connectionId, entry);
      return true;
    }
    return false;
  };
}
