# Changelog

## [1.4.2] - 2026-06-23

Thanks to [@gendronsteph](https://github.com/gendronsteph) for [#10](https://github.com/addios4u/ftpmanager/pull/10).

### Fixed
- **Configuration panel restored** — the published package was missing the webview build (`dist/webview/`), so the Configuration button opened an empty panel. The packaging step only built the extension bundle and never built the React webview. Packaging now builds the `shared` and `webview-ui` packages before the extension, so the VSIX again includes `dist/webview/webview.js` and `webview.css`. (Regression introduced in 1.4.0.)
- **Encoding-safe localization** — French/Japanese/Korean/Chinese strings in the command manifest, `package.nls.*`, l10n bundles, and the configuration webview language labels are now stored as Unicode escapes, preventing mojibake across system locales. An `.editorconfig` keeps project files UTF-8.
- **Windows packaging** — native-dependency copying in the esbuild step now resolves package paths safely and copies recursively, fixing VSIX packaging on Windows/pnpm.

## [1.4.1] - 2026-06-22

### Fixed
- **Disconnect / Reconnect no longer crash** — disconnecting or reconnecting a connected server threw `TypeError: Cannot read properties of undefined (reading 'catch')`, leaving the tree stale and tabs open. This also broke the automatic keepalive reconnect. (Regression introduced in 1.4.0.)
- **SFTP first connect no longer times out at the trust prompt** — ssh2's 15-second handshake timeout ran while the Trust-On-First-Use host-key dialog was open, so taking longer than 15s to confirm the fingerprint aborted the connection with a confusing "Timed out while waiting for handshake" error. The timeout is now extended while a trust prompt can appear.
- **Concurrent reconnects no longer leak connections** — overlapping reconnect/connect calls for the same server could orphan a client and its keepalive timer; the in-flight connection is now tracked correctly.
- **Settings dialog hardened** — the language-options lookup no longer crashes if the extension directory can't be read (remote/virtual workspaces).

### Packaging
- The published package now reliably includes the **README** (Marketplace overview) and **CHANGELOG**, which were missing from the 1.4.0 listing.

## [1.4.0] - 2026-06-22

### Added
- **Server identity verification (TOFU)** — SFTP connections now verify the server's host key and FTPS connections verify the server's certificate, using a Trust-On-First-Use model. On the first connection you're shown the SHA-256 fingerprint and asked to trust it; a known, matching fingerprint connects silently, and a changed fingerprint raises a man-in-the-middle warning that requires explicit confirmation. Trusted fingerprints are stored per server and removed when the server is deleted. This closes a gap where SFTP previously accepted any host key and FTPS skipped certificate verification. (A publicly trusted, hostname-matching FTPS certificate is accepted without a prompt.)

### Changed
- **Updated `basic-ftp` to 5.3.1** — picks up fixes for HIGH-severity advisories (FTP command injection via CRLF and denial of service).

### Fixed
- **Localization encoding** — repaired corrupted (`?`) French/Japanese/Korean/Chinese values for the new tree strings (Recent Files, Opened Files, Open remote file, Unsaved remote changes) and translated the previously-English **Reconnect** / **Reconnect Open Files** commands in the Japanese, Korean, and Simplified Chinese manifests.

## [1.3.0] - 2026-06-03

Big thanks to [@gendronsteph](https://github.com/gendronsteph) for contributing this feature set ([#3](https://github.com/addios4u/ftpmanager/pull/3)).

### Added
- **Remote file restoration on startup** — previously opened `ftpmanager://` files are reopened after restarting VS Code. The extension now activates on `onFileSystem:ftpmanager` and automatically reconnects only the servers needed by the restored tabs, with a clear warning if a reconnect fails.
- **Reconnect Open Files** — a new command and view-title button (`$(plug)`) that reconnects only the servers required by the currently open remote files.
- **Server groups** — set an optional **Group** on a connection to organize servers under group sections in the tree (e.g. Clients, Production, Staging).
- **Remote overwrite protection** — the remote file's state is captured when opened; before saving, if the remote appears to have changed since then, you're prompted to **Overwrite**, **Compare**, or **Cancel**.
- **Compare before overwrite** — an optional per-server "Ask to compare before overwrite" setting. **Compare** downloads the current remote version to a temp file and opens a VS Code diff against your local edits. For `ftpmanager://` files, `Ctrl/Cmd+S` is handled so that Compare/Cancel keep the editor dirty and only Overwrite uploads — no failed-save toast.
- **Configuration import/export** — the top tree button is now a **Configurations** gear, with **Import**/**Export** for saved servers. Export includes saved passwords/passphrases (keep the file private); import adds new servers and replaces any that already exist.
- **Theme-based file icons** — tree items expose a `resourceUri` so remote files/folders use your active File Icon Theme (`.php`, `.js`, `.css`, `.json`, `.htaccess`, …).
- **Upload feedback** — a success notification after a remote save, plus a status bar entry showing the last saved file and time (tooltip includes server name, remote path, and time).
- **Tree view visual indicators** — connected servers show a green icon, and open remote files are highlighted in the tree (without recoloring editor tabs).
- **Permanent tabs for remote files** — remote files open with `preview: false`, so same-named files from different servers (e.g. two `index.php`) can stay open at once.

### Changed
- **Tree view reveal support** — added `getParent()` and stable, path-based item IDs so restored remote files can be reliably revealed and expanded to the correct server and parent folders.

### Fixed
- **Dirty state preserved on declined overwrite** — declining an overwrite (Cancel/Compare) no longer lets VS Code mark the document as saved; unsaved edits keep their dirty indicator across all save paths (menu save, save-all, auto-save).
- **Reliable change detection** — the remote baseline is captured once when a file is opened and only reset after a successful upload, so repeated `stat()` calls during editing no longer suppress the "remote changed since it was opened" prompt.

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
