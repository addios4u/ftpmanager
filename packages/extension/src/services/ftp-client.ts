import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import * as tls from 'tls';
import * as vscode from 'vscode';
import { PassThrough, Readable } from 'stream';
import { Client as BasicFtpClient, type FileInfo, type FTPContext, enterPassiveModeIPv6 } from 'basic-ftp';
import type { FtpConnectionConfig, RemoteFileEntry } from '@ftpmanager/shared';
import type { HostKeyVerifier } from './host-trust.js';

export interface IFtpClient {
  connect(signal?: AbortSignal): Promise<void>;
  disconnect(): Promise<void>;
  list(remotePath: string): Promise<RemoteFileEntry[]>;
  downloadFile(remotePath: string, localPath: string): Promise<void>;
  downloadFolder(remotePath: string, localPath: string): Promise<void>;
  uploadFile(localPath: string, remotePath: string): Promise<void>;
  uploadFolder(localPath: string, remotePath: string): Promise<void>;
  mkdir(remotePath: string): Promise<void>;
  delete(remotePath: string): Promise<void>;
  rmdir(remotePath: string, recursive: boolean): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  getContent(remotePath: string): Promise<Buffer>;
  putContent(content: Buffer, remotePath: string): Promise<void>;
  pwd(): Promise<string>;
  /** 퍼미션 적용. permissions는 "644", "755" 등 8진수 문자열. 미지원 서버에서는 무시됨. */
  chmod(remotePath: string, permissions: string): Promise<void>;
}

function mapFileInfo(info: FileInfo): RemoteFileEntry {
  return {
    name: info.name,
    type: info.isDirectory ? 'directory' : info.isSymbolicLink ? 'symlink' : 'file',
    size: info.size,
    modifiedAt: info.modifiedAt ?? new Date(0),
    permissions: info.permissions
      ? `${info.permissions.user}${info.permissions.group}${info.permissions.world}`
      : undefined,
  };
}

let ftpOutputChannel: vscode.OutputChannel | undefined;
function getFtpChannel(): vscode.OutputChannel {
  if (!ftpOutputChannel) {
    ftpOutputChannel = vscode.window.createOutputChannel('FTP Manager');
  }
  return ftpOutputChannel;
}

function isPrivateOrLocalIP(ip: string): boolean {
  return (
    ip === '0.0.0.0' ||
    ip === '127.0.0.1' ||
    /^10\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    /^192\.168\./.test(ip)
  );
}

/**
 * NAT-safe PASV handler.
 * basic-ftp's built-in enterPassiveModeIPv4 blindly uses whatever IP the server
 * reports, which breaks when the server is behind NAT and reports its LAN IP.
 * This version substitutes the control connection's remote host in that case.
 */
async function enterPassiveModeNatSafe(ftp: FTPContext): Promise<{ code: number; message: string }> {
  const res = await ftp.request('PASV');
  const match = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(res.message);
  if (!match) {
    throw new Error(`Cannot parse PASV response: ${res.message}`);
  }
  const [, a, b, c, d, p1, p2] = match;
  const pasvHost = `${a}.${b}.${c}.${d}`;
  const port = (Number(p1) << 8) | Number(p2);

  // If server returned a private/zero IP (NAT or misconfigured server),
  // fall back to the control socket's remote address.
  const controlHost = (ftp.socket.remoteAddress as string | undefined)
    ?.replace('::ffff:', '') ?? pasvHost;
  const host = isPrivateOrLocalIP(pasvHost) ? controlHost : pasvHost;

  getFtpChannel().appendLine(
    `[FTP] PASV: server=${pasvHost}:${port}, using=${host}:${port}` +
    (isPrivateOrLocalIP(pasvHost) ? ' (NAT corrected)' : ''),
  );

  const rawSocket: net.Socket = await new Promise((resolve, reject) => {
    const s = net.createConnection({ host, port }, () => resolve(s));
    s.once('error', reject);
  });

  // For FTPS, wrap the data socket in TLS using the same context as the control socket
  if (ftp.socket instanceof tls.TLSSocket) {
    const secureContext = (ftp.socket as tls.TLSSocket & { context?: tls.SecureContext }).context;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ftp as any).dataSocket = secureContext
      ? tls.connect({ socket: rawSocket, secureContext })
      : rawSocket;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (ftp as any).dataSocket = rawSocket;
  }

  return res;
}

export class FtpClient implements IFtpClient {
  private client: BasicFtpClient;
  private _lock: Promise<void> = Promise.resolve();
  private _keepaliveTimer: ReturnType<typeof setInterval> | undefined;
  private _lastOpTime = 0;

  constructor(
    private readonly config: FtpConnectionConfig,
    private readonly password?: string,
    private readonly verifyHostKey?: HostKeyVerifier,
  ) {
    this.client = new BasicFtpClient();
    this.client.ftp.verbose = true;
    this.client.ftp.log = (msg: string) => getFtpChannel().appendLine(`[FTP] ${msg}`);
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const current = this._lock;
    let release!: () => void;
    this._lock = new Promise<void>((resolve) => { release = resolve; });
    await current;
    this._lastOpTime = Date.now();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private startKeepalive(): void {
    this._lastOpTime = Date.now();
    // Check every 10s; send NOOP only when idle for >25s to prevent server-side idle disconnect
    this._keepaliveTimer = setInterval(() => {
      if (Date.now() - this._lastOpTime >= 25_000) {
        void this.withLock(async () => {
          try { await this.client.send('NOOP'); } catch { /* ignore — client may have closed */ }
        }).catch(() => {});
      }
    }, 10_000);
  }

  private stopKeepalive(): void {
    if (this._keepaliveTimer !== undefined) {
      clearInterval(this._keepaliveTimer);
      this._keepaliveTimer = undefined;
    }
  }

  async connect(signal?: AbortSignal): Promise<void> {
    this.client.ftp.timeout = 30_000; // 30s data connection timeout

    // passiveMode: true (default) → NAT-safe PASV (IPv4)
    // passiveMode: false           → EPSV (extended passive, no IP in response — no NAT issue)
    if (this.config.passiveMode !== false) {
      this.client.ftp.ipFamily = 4;
      this.client.prepareTransfer = enterPassiveModeNatSafe;
    } else {
      this.client.prepareTransfer = (ftp) => enterPassiveModeIPv6(ftp);
    }

    const isFtps = !!(this.config.protocol === 'ftps' || this.config.secure);
    const accessPromise = this.client.access({
      host: this.config.host,
      port: this.config.port,
      user: this.config.username,
      password: this.password,
      secure: isFtps,
      // FTPS certs are commonly self-signed; we let the handshake succeed and
      // then pin the certificate ourselves via TOFU (see verifyControlCertificate).
      secureOptions: isFtps ? { rejectUnauthorized: false } : undefined,
    });
    if (!signal) {
      await accessPromise;
    } else {
      await Promise.race([
        accessPromise,
        new Promise<never>((_, reject) =>
          signal.addEventListener('abort', () => { this.client.close(); reject(new Error('Cancelled')); }, { once: true }),
        ),
      ]);
    }
    if (isFtps && this.verifyHostKey) {
      await this.verifyControlCertificate();
    }
    this.startKeepalive();
  }

  /**
   * TOFU verification of the FTPS control-connection certificate. A publicly
   * trusted chain that also matches the hostname is accepted silently;
   * otherwise the certificate's SHA-256 fingerprint is pinned via the host
   * verifier (prompting the user on first use or on change).
   *
   * Note: basic-ftp reuses these secure options for PASV data connections, so
   * only the control connection's identity is pinned here.
   */
  private async verifyControlCertificate(): Promise<void> {
    const socket = this.client.ftp.socket as unknown as Partial<tls.TLSSocket>;
    if (!socket || typeof socket.getPeerCertificate !== 'function') {
      this.client.close();
      throw new Error('Unable to verify the FTPS server certificate (no TLS socket).');
    }
    const cert = socket.getPeerCertificate();
    const hostnameError = cert && Object.keys(cert).length > 0
      ? tls.checkServerIdentity(this.config.host, cert as tls.PeerCertificate)
      : new Error('no certificate');
    // Publicly trusted chain + matching hostname → no prompt needed.
    if (socket.authorized === true && !hostnameError) return;

    if (!cert || !cert.fingerprint256) {
      this.client.close();
      throw new Error('The FTPS server presented no certificate.');
    }
    const ok = await this.verifyHostKey!({
      connectionId: this.config.id,
      host: this.config.host,
      port: this.config.port,
      protocol: 'ftps',
      fingerprint: cert.fingerprint256,
      algo: 'Certificate (SHA-256)',
    });
    if (!ok) {
      this.client.close();
      throw new Error('FTPS server certificate was not trusted.');
    }
  }

  async disconnect(): Promise<void> {
    this.stopKeepalive();
    this.client.close();
  }

  async list(remotePath: string): Promise<RemoteFileEntry[]> {
    return this.withLock(async () => {
      const items = await this.client.list(remotePath);
      return items.map(mapFileInfo);
    });
  }

  async downloadFile(remotePath: string, localPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    return this.withLock(() => this.client.downloadTo(localPath, remotePath).then(() => {}));
  }

  async downloadFolder(remotePath: string, localPath: string): Promise<void> {
    await fs.promises.mkdir(localPath, { recursive: true });
    return this.withLock(() => this.client.downloadToDir(localPath, remotePath).then(() => {}));
  }

  async uploadFile(localPath: string, remotePath: string): Promise<void> {
    return this.withLock(() => this.client.uploadFrom(localPath, remotePath).then(() => {}));
  }

  async uploadFolder(localPath: string, remotePath: string): Promise<void> {
    return this.withLock(() => this.client.uploadFromDir(localPath, remotePath).then(() => {}));
  }

  async mkdir(remotePath: string): Promise<void> {
    return this.withLock(() => this.client.ensureDir(remotePath).then(() => {}));
  }

  async delete(remotePath: string): Promise<void> {
    return this.withLock(() => this.client.remove(remotePath).then(() => {}));
  }

  async rmdir(remotePath: string, _recursive: boolean): Promise<void> {
    return this.withLock(() => this.client.removeDir(remotePath).then(() => {}));
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    return this.withLock(() => this.client.rename(oldPath, newPath).then(() => {}));
  }

  async pwd(): Promise<string> {
    return this.withLock(() => this.client.pwd());
  }

  async chmod(remotePath: string, permissions: string): Promise<void> {
    // 퍼미션은 순수 숫자 3~4자리여야 함 — CRLF 인젝션 방지
    if (!/^\d{3,4}$/.test(permissions)) return;
    return this.withLock(async () => {
      try {
        await this.client.send(`SITE CHMOD ${permissions} ${remotePath}`);
      } catch {
        // SITE CHMOD 미지원 서버는 무시
      }
    });
  }

  async getContent(remotePath: string): Promise<Buffer> {
    return this.withLock(async () => {
      const chunks: Buffer[] = [];
      const pt = new PassThrough();
      pt.on('data', (chunk: Buffer) => chunks.push(chunk));
      await this.client.downloadTo(pt as unknown as fs.WriteStream, remotePath);
      return Buffer.concat(chunks);
    });
  }

  async putContent(content: Buffer, remotePath: string): Promise<void> {
    return this.withLock(async () => {
      const readable = Readable.from(content);
      await this.client.uploadFrom(readable as unknown as fs.ReadStream, remotePath);
    });
  }
}
