import React from 'react';
import { useConnectionStore } from '../../stores/connection.js';
import { postMessage } from '../../vscode-api.js';

export function WelcomeView() {
  const { connections, setViewState } = useConnectionStore();

  return (
    <div className="welcome-view">
      <div className="welcome-header">
        <h1>FTP Manager</h1>
        <p>Connect to remote servers via FTP, FTPS, or SFTP</p>
      </div>

      {connections.length > 0 && (
        <div className="server-list">
          <h2>Saved Servers</h2>
          {connections.map((conn) => (
            <div key={conn.id} className="server-item">
              <span className={`protocol-badge ${conn.protocol}`}>{conn.protocol.toUpperCase()}</span>
              <span className="server-name">{conn.name}</span>
              <span className="server-host">{conn.host}:{conn.port}</span>
              <div className="server-actions">
                <button
                  onClick={() => setViewState({ view: 'connectionDialog', editId: conn.id })}
                >
                  Edit
                </button>
                <button
                  className="danger"
                  onClick={() => postMessage({ type: 'deleteConnection', connectionId: conn.id })}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="welcome-actions">
        <button
          className="add-server-btn"
          onClick={() => setViewState({ view: 'connectionDialog' })}
        >
          + Add Server
        </button>
        <button
          className="coffee-btn"
          onClick={() => postMessage({ type: 'openExternal', url: 'https://buymeacoffee.com/addios4u' })}
        >
          ☕ Buy me a coffee
        </button>
      </div>
    </div>
  );
}
