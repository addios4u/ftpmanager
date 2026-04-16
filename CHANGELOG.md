# Changelog

## [1.2.4] - 2026-04-16

### Added
- **Search from folder** — Search remote files starting from a specific folder instead of always from the server root.
  - Right-click any folder in the tree view → "Search Files" to search directly within that folder.
  - When triggering search from the command palette or server node, a drill-down folder picker lets you navigate and select the starting folder before entering a keyword.

## [1.2.3] - 2026-04-09

### Fixed
- **FTP/FTPS keepalive** — Added NOOP keepalive for FTP/FTPS connections. A `NOOP` command is sent automatically after 25 seconds of inactivity to prevent the server from closing the idle connection.
- **SFTP keepalive** — Enabled SSH2 `keepaliveInterval` (25s) for SFTP connections to prevent the same idle disconnect issue.
- **Auto-reconnect on stale connection** — All file operations (save, open, list, delete, rename, etc.) now detect a dropped connection and automatically reconnect and retry, so users no longer need to manually reconnect after an idle disconnect.

## [1.2.2] - 2026-04-09

### Added
- **Permission selection on file create** — when creating a new file, a QuickPick prompt lets you choose the permissions (`644`, `664`, `755`, `600`, or custom). Skip to use the server's default.
- **Permission selection on upload** — when uploading files (via command or drag-and-drop), a single QuickPick prompt applies the chosen permissions to all uploaded files.
- **Permissions display in tree view** — files and folders now show their Unix permissions (e.g. `(644)`) next to the name in the explorer panel. Servers that don't report permissions show nothing.
- **Change Permissions context menu** — right-click any file or folder to change its permissions via the same QuickPick. The badge updates immediately on success.

### Fixed
- **Localization gaps (ko/ja/zh-cn)** — permission-related strings, duplicate feature strings, and several other missing keys were added to all three locale files.

## [1.2.1] - 2026-04-09

### Fixed
- **Permission preservation on edit** — Unix file permissions (chmod) are now restored after saving a remote file edited in VS Code
- **Permission preservation on duplicate** — Duplicated files and folders now inherit the same permissions as the source (folders apply permissions recursively to all children)
- **FTP permission parsing bug** — `UnixPermissions` object was incorrectly serialized as `"[object Object]"`; now correctly formatted as an octal string (e.g. `"644"`)
- **SFTP permission format alignment** — SFTP symbolic permissions (e.g. `"rwxr-xr-x"`) are now normalized to the same octal format as FTP (e.g. `"755"`)
- **SITE CHMOD injection guard** — FTP `chmod` now validates the permissions value before sending the `SITE CHMOD` command

## [1.2.0] - 2026-04-08

### Added
- **Duplicate** — right-click any remote file or folder to create a copy in the same directory (`_copy` suffix, auto-increments on conflict)
- **Remote file search** — search remote files by name or content directly from the tree view
- **OS drag-and-drop upload** — drag local files from Finder/Explorer onto the tree view to upload

## [1.0.0] - 2026-03-06

### Added
- Initial release of FTPManager for VS Code
- FTP, FTPS, and SFTP protocol support
- Explorer panel with server tree view
- Drag-and-drop server reordering
- Connect and disconnect from servers
- Browse remote directories
- Upload files to remote server (single file and from Explorer context menu)
- Download files and folders from remote server
- Open and edit remote files directly in VS Code (auto-upload on save)
- Create new remote folders
- Rename remote files and folders
- Delete remote files and folders
- Copy remote path to clipboard
- SSH key-based authentication for SFTP
- Secure password storage via VS Code Secret Storage
- Test connection before saving
- Korean (ko) localization
