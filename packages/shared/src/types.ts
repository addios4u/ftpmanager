export type FtpProtocol = 'ftp' | 'ftps' | 'sftp';

export interface FtpConnectionConfig {
  id: string;
  name: string;
  protocol: FtpProtocol;
  host: string;
  port: number;
  username: string;
  remotePath: string;      // default remote directory e.g. /public_html
  privateKeyPath?: string; // SFTP only
  group?: string;
  color?: string;
  secure?: boolean;        // FTPS explicit TLS
  passiveMode?: boolean;   // FTP passive mode
}

export interface FtpConnectionInfo extends FtpConnectionConfig {
  isConnected: boolean;
}

export type FtpNodeType = 'server' | 'directory' | 'file';

export interface RemoteFileEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: Date;
  permissions?: string;
}

export type ViewState =
  | { view: 'welcome' }
  | { view: 'connectionDialog'; editId?: string };

export interface TransferProgress {
  transferId: string;
  fileName: string;
  direction: 'upload' | 'download';
  bytesTransferred: number;
  totalBytes: number;
  percent: number;
}
