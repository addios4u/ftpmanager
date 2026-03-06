export const VIEW_IDS = {
  SERVERS: 'ftpmanager.servers',
} as const;

export const COMMAND_IDS = {
  ADD_SERVER: 'ftpmanager.addServer',
  EDIT_SERVER: 'ftpmanager.editServer',
  DELETE_SERVER: 'ftpmanager.deleteServer',
  CONNECT: 'ftpmanager.connect',
  DISCONNECT: 'ftpmanager.disconnect',
  REFRESH: 'ftpmanager.refresh',
  UPLOAD_FILE: 'ftpmanager.uploadFile',
  DOWNLOAD_FILE: 'ftpmanager.downloadFile',
  DOWNLOAD_FOLDER: 'ftpmanager.downloadFolder',
  NEW_FOLDER: 'ftpmanager.newFolder',
  NEW_FILE: 'ftpmanager.newFile',
  RENAME: 'ftpmanager.rename',
  DELETE_REMOTE: 'ftpmanager.deleteRemote',
  COPY_REMOTE_PATH: 'ftpmanager.copyRemotePath',
  UPLOAD_TO_SERVER: 'ftpmanager.uploadToServer',
  OPEN_REMOTE_FILE: 'ftpmanager.openRemoteFile',
} as const;

export const DEFAULT_PORTS: Record<string, number> = {
  ftp: 21,
  ftps: 21,
  sftp: 22,
};

export const EXTENSION_ID = 'ftpmanager';
export const CONNECTIONS_KEY = 'ftpmanager.connections';
export const PASSWORD_KEY_PREFIX = 'ftpmanager.password.';
export const PASSPHRASE_KEY_PREFIX = 'ftpmanager.passphrase.';
