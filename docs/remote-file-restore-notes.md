# Remote File Restore Notes

This note documents the behavior added in the locally modified VS Code extension package
`addios4u.ftpmanager-1.2.4`.

## Added behavior

### Automatic restoration of remote files on VS Code startup

- Reopens previously opened `ftpmanager://...` files after restarting VS Code.
- When VS Code restores remote FTP/SFTP tabs, the extension attempts to reconnect to the required server automatically.
- This prevents restored remote files from failing immediately when the FTP/SFTP connection has not yet been established.

### File system activation event

- Adds the `onFileSystem:ftpmanager` activation event.
- Ensures the extension is activated when VS Code attempts to restore or open a `ftpmanager://` URI.
- Fixes startup errors where VS Code tried to open a remote file before the FTPManager file system provider was registered.

### Smarter reconnect behavior

- Detects which FTP/SFTP connections are required by the previously opened remote files.
- Reconnects only the necessary servers automatically.
- Shows a clearer error message when a connection fails instead of leaving only a generic VS Code editor error.

### Automatic FTPManager TreeView focus on restore

- Opens and focuses the FTPManager view when remote files are restored on startup.
- This only happens when FTPManager files were part of the previous session, so normal VS Code startup is not affected.

### Reveal restored files in TreeView

- Expands the FTPManager TreeView to the relevant server and parent folders for restored files.
- Example:

```text
server-name
└── public_html
    └── index.php
```

- Adds TreeView parent resolution so VS Code can reveal nested remote files reliably.

### TreeView `getParent()` support

- Adds `TreeDataProvider` parent resolution support.
- Allows VS Code to reconstruct the full path of a remote file inside the TreeView.
- Required for reliable `treeView.reveal(...)` behavior on nested files and folders.

### Stable TreeView item IDs

- Adds stable IDs for remote files and folders.
- IDs are based on the connection and remote path.
- Improves VS Code's ability to track and reveal TreeView elements.

### Open files as permanent tabs

- Opens remote files with `preview: false`.
- Prevents VS Code from replacing an already opened FTP file when another file with the same name is opened.
- Example fixed case:

```text
domain1.com / public_html / index.php
domain2.com / public_html / index.php
```

Both files can remain open at the same time.

### Theme-based file icons in FTPManager TreeView

- TreeView items provide a `resourceUri`.
- Allows VS Code to use the active File Icon Theme for remote FTP files and folders.
- File icons match the icons used in VS Code tabs and the Explorer.

Examples:

```text
.php        -> PHP icon
.js         -> JavaScript icon
.css        -> CSS icon
.json       -> JSON icon
.htaccess   -> config/Apache icon, depending on the active icon theme
```

### Upload success notification

- Adds a success notification after saving/uploading a remote file.
- Example: `index.php uploaded to domain1.com`

### Status bar save feedback

- Adds status bar feedback after a successful remote upload.
- Displays the last saved/uploaded file and time.
- Tooltip includes the server name, remote path, and save time.

Example:

```text
FTPManager: index.php saved 14:52:10
```

### Remote overwrite protection

- Tracks the remote file state when a file is opened.
- Before uploading/saving, checks whether the remote file appears to have changed since it was opened.
- If the remote file changed, prompts the user before overwriting it.

Example prompt:

```text
The remote file "index.php" on domain1.com changed since it was opened. Overwrite it?
```

Options: `Overwrite` / `Cancel`

### Connected server visual indicator

- Connected servers have a green server icon in the FTPManager TreeView.
- Makes connected servers easier to identify without changing the TreeView label styling.

## Verification note

The VSIX/package folder includes compiled JavaScript under `dist/extension.js`. To guarantee identical behavior
from source, the TypeScript source must contain the same restore, TreeView reveal, status bar, overwrite protection,
and activation-event logic before packaging a new VSIX.
