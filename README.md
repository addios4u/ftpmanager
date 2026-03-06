# FTPManager

FTP/SFTP client extension for VS Code and Cursor — browse, edit, upload, and download files on remote servers directly from your editor, just like EditPlus.

## Features

- **FTP / FTPS / SFTP** protocol support
- **Explorer panel integration** — FTP Manager tree view in the sidebar
- **Remote file editing** — click any file to open and edit it; saving auto-uploads to the server
- **Upload / Download** — single files or entire folders
- **Context menu actions** — rename, delete, new folder, copy remote path
- **Drag & drop** — drop local files onto the FTP tree to upload
- **Password & key security** — credentials stored in VS Code SecretStorage (encrypted)
- **SSH key authentication** — SFTP with private key + passphrase

## Usage

1. Open the **FTP Manager** panel in the Explorer sidebar
2. Click **+** to add a server
3. Enter connection details and click **Save**
4. Click the server to connect and browse files
5. Click any file to open it in the editor — saving auto-uploads changes

## Supported Protocols

| Protocol | Port | Notes |
|----------|------|-------|
| FTP | 21 | Standard FTP |
| FTPS | 21 | FTP over TLS |
| SFTP | 22 | SSH File Transfer Protocol |

## Requirements

VS Code 1.95.0 or later.

## License

MIT
