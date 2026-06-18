import React from 'react';
import { useConnectionStore } from '../../stores/connection.js';
import { postMessage } from '../../vscode-api.js';

export function WelcomeView() {
  const { connections, viewLocation, setViewState, setViewLocation } = useConnectionStore();

  const updateViewLocation = (nextLocation: 'explorer' | 'activityBar') => {
    setViewLocation(nextLocation);
    postMessage({ type: 'updateViewLocation', viewLocation: nextLocation });
  };

  return (
    <div className="welcome-view">
      <div className="welcome-header">
        <h1>FTP Manager</h1>
        <p>Connect to remote servers via FTP, FTPS, or SFTP</p>
      </div>

      <div className="configuration-actions">
        <button onClick={() => postMessage({ type: 'importConnections' })}>
          Import
        </button>
        <button onClick={() => postMessage({ type: 'exportConnections' })}>
          Export
        </button>
      </div>
      <div className="security-warning">
        Export files include saved passwords. Keep exported JSON files private and only import files you trust.
      </div>

      <div className="view-location-setting">
        <div>
          <h2>View Location</h2>
          <p>Choose where the FTPManager tree is shown.</p>
        </div>
        <div className="segmented-control" role="group" aria-label="FTPManager view location">
          <button
            className={viewLocation === 'explorer' ? 'active' : ''}
            onClick={() => updateViewLocation('explorer')}
          >
            Explorer
          </button>
          <button
            className={viewLocation === 'activityBar' ? 'active' : ''}
            onClick={() => updateViewLocation('activityBar')}
          >
            Activity Bar
          </button>
        </div>
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
