# Changelog

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
